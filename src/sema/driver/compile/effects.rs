use super::{BuildDiagnostic, BunTypes, WithoutBunTypes};
use crate::{Category, Diagnostic, MessageChain};
use bun_sema::atom::{Atom, known};
use bun_sema::check::Requested;
use bun_sema::check::aot::{DiagnosticClass, DiagnosticSubject, Effect, FileOrigin, effect_of};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::program::{CodeAnswer, FileId, FileRole, Files, ReadingNoTrees, Sym};
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
        | FileOrigin::TestedSource
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
        (FileRole::Checked, false) if project_origin == FileOrigin::TestedSource => {
            FileOrigin::TestedSource
        }
        (FileRole::Checked, false) => FileOrigin::ProgramSource,
        (FileRole::Inferred, true) => FileOrigin::DependencyJavaScript,
        (FileRole::Inferred, false) => FileOrigin::ProgramJavaScript,
    }
}

pub(super) fn can_lose_trust(origin: FileOrigin) -> bool {
    effect_of(origin, DiagnosticClass::EarlyError, Category::Error) == Effect::WithdrawsTrust
}

pub(super) fn requested_diagnostics(origin: FileOrigin, looks_for_type_errors: bool) -> Requested {
    if looks_for_type_errors
        && effect_of(origin, DiagnosticClass::Semantic, Category::Error) == Effect::StopsBuild
    {
        return Requested::All;
    }
    match effect_of(origin, DiagnosticClass::EarlyError, Category::Error) {
        Effect::StopsBuild | Effect::Warns | Effect::WithdrawsTrust => Requested::EarlyErrors,
        Effect::Dropped | Effect::InternalError => Requested::Types,
    }
}

pub(super) struct ProgramOrigins<'a, 's> {
    pub files: Option<&'a Files<'s>>,
    pub origins: &'a [FileOrigin],
    pub project_origin: FileOrigin,
    pub bun_types: &'a BunTypes,
    pub has_configuration_file: bool,
}

const UNKNOWN_MODULE_CODES: [u32; 4] = [2307, 2792, 2882, 7016];

const USES_OF_WHAT_HAS_NO_DECLARATION_CODES: [u32; 2] = [2347, 2709];

const UNKNOWN_TYPE_LIBRARY_CODE: u32 = 2688;
const UNUSED_EXPECT_ERROR_CODE: u32 = 2578;

const EXACT_OPTIONAL_PROPERTY_CODES: [u32; 3] = [2375, 2379, 2412];

const UNKNOWN_MEMBER_CODES: [u32; 6] = [2305, 2339, 2551, 2614, 2694, 2724];

const UNKNOWN_NAME_CODES: [u32; 25] = [
    2304, 2311, 2318, 2468, 2503, 2550, 2552, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592, 2593,
    2662, 2663, 2812, 2833, 2867, 2868, 2874, 2879, 18004,
];

const DECLARATION_OF_ANOTHER_KIND_CODES: [u32; 2] = [2315, 2749];

fn is_about_exact_optional_property(code: u32, chain: &[MessageChain]) -> bool {
    EXACT_OPTIONAL_PROPERTY_CODES.contains(&code)
        || chain
            .iter()
            .any(|link| is_about_exact_optional_property(link.code, &link.message_chain))
}

fn had_declaration_with_bun_types(missing: &WithoutBunTypes, diagnostic: &Diagnostic) -> bool {
    let Some(errors) = &missing.errors_with_bun_types else {
        return false;
    };
    let lacks_declaration = UNKNOWN_NAME_CODES.contains(&diagnostic.code)
        || UNKNOWN_MEMBER_CODES.contains(&diagnostic.code)
        || DECLARATION_OF_ANOTHER_KIND_CODES.contains(&diagnostic.code);
    let place = (&diagnostic.path[..], diagnostic.start);
    lacks_declaration
        && diagnostic.file.is_some()
        && errors
            .binary_search_by(|(path, start)| (&path[..], *start).cmp(&place))
            .is_err()
}

impl ProgramOrigins<'_, '_> {
    fn origin_of(&self, diagnostic: &Diagnostic) -> FileOrigin {
        match diagnostic.file {
            Some(file) => self.origins[file.idx()],
            None if self.project_origin == FileOrigin::TestedSource => FileOrigin::NoFile,
            None => self.project_origin,
        }
    }

    fn is_for_lack_of_bun_types(&self, origin: FileOrigin, diagnostic: &Diagnostic) -> bool {
        let missing = match self.bun_types {
            BunTypes::Installed => return false,
            BunTypes::Brought => None,
            BunTypes::Missing(missing) => Some(missing),
        };
        let code = diagnostic.code;
        if origin != FileOrigin::ProgramSource && origin != FileOrigin::TestedSource {
            return false;
        }
        if missing.is_some_and(|missing| had_declaration_with_bun_types(missing, diagnostic)) {
            return true;
        }
        if UNKNOWN_MODULE_CODES.contains(&code) {
            match diagnostic.subject {
                DiagnosticSubject::ModuleSpecifier(specifier) => {
                    self.is_import_that_the_build_loads(diagnostic.file, specifier)
                }
                DiagnosticSubject::None | DiagnosticSubject::MemberContainer(_) => false,
            }
        } else if UNKNOWN_MEMBER_CODES.contains(&code) {
            match (missing, diagnostic.subject) {
                (Some(missing), DiagnosticSubject::MemberContainer(container)) => {
                    missing.incomplete_containers.contains(&Some(container))
                        || self.is_declared_in_place_of_bun_types(container)
                        || self.is_declared_for_browsers(container)
                }
                (None, DiagnosticSubject::MemberContainer(_))
                | (_, DiagnosticSubject::None | DiagnosticSubject::ModuleSpecifier(_)) => false,
            }
        } else if diagnostic.class == DiagnosticClass::Style {
            !self.has_configuration_file
        } else {
            USES_OF_WHAT_HAS_NO_DECLARATION_CODES.contains(&code)
        }
    }

    fn is_about_name_stored_beside_module_exports(&self, diagnostic: &Diagnostic) -> bool {
        let (Some(files), DiagnosticSubject::MemberContainer(container)) =
            (self.files, diagnostic.subject)
        else {
            return false;
        };
        let name = match diagnostic.code {
            2305 => diagnostic.args.get(1),
            2339 => diagnostic.args.first(),
            _ => None,
        };
        let Some(name) = name.and_then(|name| files.atoms.lookup(name)) else {
            return false;
        };
        if !files.hir(container.file).is_js || !files.module(container.file).is_module() {
            return false;
        }
        let module = files.file_symbol(container.file);
        name != known::export_equals
            && files.export(module, known::export_equals).is_some()
            && files.export(module, name).is_some()
    }

    fn is_in_jsdoc_comment(&self, diagnostic: &Diagnostic) -> bool {
        let (Some(files), Some(file)) = (self.files, diagnostic.file) else {
            return false;
        };
        !diagnostic.has_undefined_range && files.hir(file).is_in_jsdoc(diagnostic.start)
    }

    fn is_declared_in_place_of_bun_types(&self, container: Sym) -> bool {
        (self.files).is_some_and(|files| files.is_of_last_resort(container.file))
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
        let _reading = ReadingNoTrees::begin();
        crate::sort_and_deduplicate(&mut diagnostics);
        let with_effects = diagnostics.into_iter().filter_map(|mut diagnostic| {
            let origin = self.origin_of(&diagnostic);
            if diagnostic.class == DiagnosticClass::EarlyError {
                diagnostic.category = Category::Error;
            }
            let is_for_lack_of_bun_types = self.is_for_lack_of_bun_types(origin, &diagnostic);
            let names_missing_type_library = !matches!(self.bun_types, BunTypes::Installed)
                && diagnostic.code == UNKNOWN_TYPE_LIBRARY_CODE;
            let effect = match effect_of(origin, diagnostic.class, diagnostic.category) {
                Effect::Dropped => return None,
                Effect::StopsBuild if self.is_in_jsdoc_comment(&diagnostic) => return None,
                Effect::StopsBuild | Effect::WithdrawsTrust
                    if self.is_from_option_the_file_does_not_have(&diagnostic) =>
                {
                    return None;
                }
                Effect::StopsBuild | Effect::WithdrawsTrust | Effect::Warns
                    if self.is_about_name_stored_beside_module_exports(&diagnostic) =>
                {
                    return None;
                }
                Effect::StopsBuild if diagnostic.code == UNUSED_EXPECT_ERROR_CODE => Effect::Warns,
                Effect::StopsBuild if is_for_lack_of_bun_types => return None,
                Effect::WithdrawsTrust | Effect::Warns
                    if origin == FileOrigin::TestedSource && is_for_lack_of_bun_types =>
                {
                    return None;
                }
                Effect::WithdrawsTrust
                    if origin == FileOrigin::TestedSource
                        && diagnostic.code == UNUSED_EXPECT_ERROR_CODE =>
                {
                    Effect::Warns
                }
                Effect::StopsBuild if names_missing_type_library => Effect::Warns,
                Effect::StopsBuild
                    if diagnostic.file.is_none()
                        && self.project_origin == FileOrigin::TestedSource
                        && diagnostic.class != DiagnosticClass::EarlyError =>
                {
                    Effect::Warns
                }
                Effect::WithdrawsTrust if diagnostic.file.is_none() => Effect::InternalError,
                Effect::WithdrawsTrust if diagnostic.class != DiagnosticClass::EarlyError => {
                    return None;
                }
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
            (NoFile, Requested::EarlyErrors),
            (ProgramSource, Requested::EarlyErrors),
            (TestedSource, Requested::EarlyErrors),
            (ProgramJavaScript, Requested::EarlyErrors),
            (DependencySource, Requested::EarlyErrors),
            (DependencyJavaScript, Requested::EarlyErrors),
            (Declarations, Requested::EarlyErrors),
            (Runtime, Requested::Types),
            (EvaluatedText, Requested::EarlyErrors),
        ];
        for (origin, requested) in expected {
            assert!(
                requested_diagnostics(origin, false) == requested,
                "{origin:?}"
            );
            let checked = match origin {
                NoFile | ProgramSource => Requested::All,
                _ => requested,
            };
            assert!(requested_diagnostics(origin, true) == checked, "{origin:?}");
        }
    }

    #[test]
    fn trust_is_lost_to_early_errors_alone() {
        use FileOrigin::*;
        let expected = [
            (NoFile, false),
            (ProgramSource, false),
            (TestedSource, false),
            (ProgramJavaScript, false),
            (DependencySource, false),
            (DependencyJavaScript, false),
            (Declarations, false),
            (Runtime, false),
            (EvaluatedText, true),
        ];
        for (origin, can_lose) in expected {
            assert_eq!(can_lose_trust(origin), can_lose, "{origin:?}");
        }
    }

    #[test]
    fn type_error_that_came_to_light_takes_no_types_away() {
        for origin in [
            FileOrigin::DependencySource,
            FileOrigin::TestedSource,
            FileOrigin::Runtime,
        ] {
            let origins = ProgramOrigins {
                files: None,
                origins: &[origin],
                project_origin: FileOrigin::NoFile,
                bun_types: &BunTypes::Installed,
                has_configuration_file: true,
            };
            let diagnostic = Diagnostic {
                file: Some(FileId(0)),
                class: DiagnosticClass::Semantic,
                ..crate::global(2322, &["string", "number"])
            };
            assert!(origins.apply_effects(vec![diagnostic]).is_empty());
        }
    }

    #[test]
    fn dropped_diagnostics_are_not_returned() {
        let origins = ProgramOrigins {
            files: None,
            origins: &[],
            project_origin: FileOrigin::NoFile,
            bun_types: &BunTypes::Installed,
            has_configuration_file: true,
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
        let [bun_module, import_meta, own_type, node_namespace] =
            [symbol(0), symbol(1), symbol(2), symbol(3)];
        let incomplete_containers = [
            Some(bun_module),
            Some(import_meta),
            None,
            Some(node_namespace),
        ];
        let missing = BunTypes::Missing(WithoutBunTypes {
            incomplete_containers,
            errors_with_bun_types: None,
        });
        let installed = BunTypes::Installed;
        let stops_build = |bun_types: &BunTypes,
                           has_configuration_file: bool,
                           code: u32,
                           args: &[&str],
                           subject: DiagnosticSubject| {
            let origins = ProgramOrigins {
                files: None,
                origins: &[FileOrigin::ProgramSource],
                project_origin: FileOrigin::NoFile,
                bun_types,
                has_configuration_file,
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
        let cases: [(u32, &[&str], DiagnosticSubject, bool); 16] = [
            (2584, &["document"], NoSubject, true),
            (2304, &["nothing"], NoSubject, true),
            (2307, &["./missing"], NoSubject, true),
            (2339, &["serve", "A"], MemberContainer(bun_module), false),
            (2305, &["A", "serve"], MemberContainer(bun_module), false),
            (2694, &["A", "Server"], MemberContainer(bun_module), false),
            (2339, &["dir", "A"], MemberContainer(import_meta), false),
            (
                2694,
                &["A", "Process"],
                MemberContainer(node_namespace),
                false,
            ),
            (2694, &["Own", "Process"], MemberContainer(own_type), true),
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
            for has_configuration_file in [false, true] {
                assert_eq!(
                    stops_build(&missing, has_configuration_file, code, args, subject),
                    still_stops,
                    "{code} {args:?}"
                );
                assert!(
                    stops_build(&installed, has_configuration_file, code, args, subject),
                    "{code} {args:?}"
                );
            }
        }
        let implicit_any: (u32, &[&str]) = (7006, &["request", "any"]);
        for has_configuration_file in [false, true] {
            assert_eq!(
                stops_build(
                    &missing,
                    has_configuration_file,
                    implicit_any.0,
                    implicit_any.1,
                    NoSubject
                ),
                has_configuration_file
            );
        }
    }

    #[test]
    fn brought_bun_types_hold_no_program_to_what_is_not_installed() {
        let stops_build = |is_installed: bool, has_configuration_file: bool, code: u32| {
            let origins = ProgramOrigins {
                files: None,
                origins: &[FileOrigin::ProgramSource],
                project_origin: FileOrigin::NoFile,
                bun_types: match is_installed {
                    true => &BunTypes::Installed,
                    false => &BunTypes::Brought,
                },
                has_configuration_file,
            };
            let diagnostic = Diagnostic {
                file: Some(FileId(0)),
                class: DiagnosticClass::of_code(code),
                ..crate::global(code, &["A", "B"])
            };
            !origins.apply_effects(vec![diagnostic]).is_empty()
        };
        for has_configuration_file in [false, true] {
            for code in USES_OF_WHAT_HAS_NO_DECLARATION_CODES {
                assert!(!stops_build(false, has_configuration_file, code), "{code}");
                assert!(stops_build(true, has_configuration_file, code), "{code}");
            }
            for code in [7006, 7031, 2683] {
                assert_eq!(
                    stops_build(false, has_configuration_file, code),
                    has_configuration_file,
                    "{code}"
                );
                assert!(stops_build(true, has_configuration_file, code), "{code}");
            }
            for code in [2304, 2322, 2339, 2345, 2584, 2694, 2307, 7016] {
                assert!(stops_build(false, has_configuration_file, code), "{code}");
                assert!(stops_build(true, has_configuration_file, code), "{code}");
            }
        }
    }

    #[test]
    fn what_had_a_declaration_with_bun_types_stops_no_build_without_them() {
        let missing = BunTypes::Missing(WithoutBunTypes {
            incomplete_containers: [None; 4],
            errors_with_bun_types: Some(vec![(b"/a.ts".to_vec(), 7), (b"/b.ts".to_vec(), 3)]),
        });
        let stops_build = |code: u32, path: &[u8], start: u32| {
            let origins = ProgramOrigins {
                files: None,
                origins: &[FileOrigin::ProgramSource],
                project_origin: FileOrigin::NoFile,
                bun_types: &missing,
                has_configuration_file: true,
            };
            let diagnostic = Diagnostic {
                file: Some(FileId(0)),
                path: path.to_vec(),
                start,
                class: DiagnosticClass::of_code(code),
                ..crate::global(code, &["A", "B"])
            };
            !origins.apply_effects(vec![diagnostic]).is_empty()
        };
        for code in [2304, 2503, 2552, 2580, 2749, 2315, 2339, 2694] {
            assert!(!stops_build(code, b"/a.ts", 3), "{code}");
            assert!(!stops_build(code, b"/c.ts", 7), "{code}");
            assert!(stops_build(code, b"/a.ts", 7), "{code}");
            assert!(stops_build(code, b"/b.ts", 3), "{code}");
        }
        for code in [2322, 2345, 2554] {
            assert!(stops_build(code, b"/a.ts", 3), "{code}");
        }
        for code in [
            2307, 2664, 2665, 2732, 2834, 2835, 2875, 2882, 6053, 6263, 6305, 7016, 7042,
        ] {
            assert!(stops_build(code, b"/a.ts", 3), "{code}");
        }
        for code in UNKNOWN_NAME_CODES {
            let class = DiagnosticClass::of_code(code);
            assert_eq!(class, DiagnosticClass::MissingDeclaration, "{code}");
            assert!(!stops_build(code, b"/a.ts", 3), "{code}");
        }
    }

    #[test]
    fn configuration_error_stops_an_executable_and_no_run_of_tests() {
        let effect_in = |project_origin: FileOrigin, code: u32| {
            let origins = ProgramOrigins {
                files: None,
                origins: &[],
                project_origin,
                bun_types: &BunTypes::Installed,
                has_configuration_file: true,
            };
            let diagnostic = Diagnostic {
                class: DiagnosticClass::of_code(code),
                ..crate::global(code, &["a"])
            };
            origins.apply_effects(vec![diagnostic])[0].effect
        };
        for code in [UNKNOWN_TYPE_LIBRARY_CODE, 5083] {
            assert_eq!(
                effect_in(FileOrigin::ProgramSource, code),
                Effect::StopsBuild
            );
            assert_eq!(effect_in(FileOrigin::TestedSource, code), Effect::Warns);
        }
    }

    #[test]
    fn configuration_error_of_runtime_project_is_internal() {
        let origins = ProgramOrigins {
            files: None,
            origins: &[],
            project_origin: FileOrigin::Runtime,
            bun_types: &BunTypes::Installed,
            has_configuration_file: true,
        };
        let reported = origins.apply_effects(vec![crate::global(5083, &["a"])]);
        assert_eq!(reported[0].effect, Effect::InternalError);
    }
}
