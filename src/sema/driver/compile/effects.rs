use super::{BuildDiagnostic, WithoutBunTypes};
use crate::{Category, Diagnostic, MessageChain};
use bun_sema::atom::{Atom, known};
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

pub(super) fn requested_diagnostics_of_file(
    files: &Files<'_>,
    file: FileId,
    origin: FileOrigin,
    role: FileRole,
) -> Requested {
    match requested_diagnostics(origin, role) {
        Requested::All if files.hir(file).syntax_errors().next().is_some() => {
            Requested::EarlyErrors
        }
        requested => requested,
    }
}

pub(super) fn requested_diagnostics(origin: FileOrigin, role: FileRole) -> Requested {
    match (origin, role) {
        (FileOrigin::Runtime, FileRole::Inferred | FileRole::TypesOnly) => return Requested::Types,
        (FileOrigin::Runtime, FileRole::Checked)
        | (
            FileOrigin::NoFile
            | FileOrigin::ProgramSource
            | FileOrigin::TestedSource
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

const UNKNOWN_MEMBER_CODES: [u32; 6] = [2305, 2339, 2551, 2614, 2694, 2724];

// The rest of `DiagnosticClass::MissingDeclaration` is about a module or a file.
const UNKNOWN_NAME_CODES: [u32; 25] = [
    2304, 2311, 2318, 2468, 2503, 2550, 2552, 2580, 2581, 2582, 2583, 2584, 2585, 2591, 2592, 2593,
    2662, 2663, 2812, 2833, 2867, 2868, 2874, 2879, 18004,
];

// What stands in for Bun's types declares the name, as a variable where they have a type too, or as `any` where their type is generic.
const DECLARATION_OF_ANOTHER_KIND_CODES: [u32; 2] = [2315, 2749];

fn is_about_exact_optional_property(code: u32, chain: &[MessageChain]) -> bool {
    EXACT_OPTIONAL_PROPERTY_CODES.contains(&code)
        || chain
            .iter()
            .any(|link| is_about_exact_optional_property(link.code, &link.message_chain))
}

/// With Bun's types the build had every declaration that it has without them. So a name that had a declaration then and has none
/// now is theirs: `BufferEncoding`, which is a type alone and in no table of the run time. The checker takes it as `any`.
/// A module is not asked here. `declare module "*.txt"` of theirs stands for files of the program, so with them the build says
/// nothing of `import text from "./note.txt"`, whatever the project's own files and options have to say of it.
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
        let Some(missing) = self.without_bun_types else {
            return false;
        };
        let code = diagnostic.code;
        if origin != FileOrigin::ProgramSource && origin != FileOrigin::TestedSource {
            return false;
        }
        if had_declaration_with_bun_types(missing, diagnostic) {
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
            match diagnostic.subject {
                DiagnosticSubject::MemberContainer(container) => {
                    missing.incomplete_containers.contains(&Some(container))
                        || self.is_declared_in_place_of_bun_types(container)
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

    /// `module.exports = f; module.exports.used = ..` of a JavaScript file. The checker lists what `f` has by its type. When
    /// the program runs `require` answers `f`, which has `used` by then.
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

    /// `/** @param {(this: @f() number) => void} a */`: TS1206. A mistake in a comment of a .js file stops no build.
    fn is_in_jsdoc_comment(&self, diagnostic: &Diagnostic) -> bool {
        let (Some(files), Some(file)) = (self.files, diagnostic.file) else {
            return false;
        };
        !diagnostic.has_undefined_range && files.hir(file).is_in_jsdoc(diagnostic.start)
    }

    /// `declare module "node:fs";` says that the module is there and nothing of what it has: `fs.Stats` is `any`, as
    /// `Stats` of `import { Stats } from "node:fs"` is.
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
            (TestedSource, FileRole::Checked, Requested::All),
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
            (TestedSource, FileRole::Checked, true),
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
        let [bun_module, import_meta, own_type, node_namespace] =
            [symbol(0), symbol(1), symbol(2), symbol(3)];
        let incomplete_containers = [
            Some(bun_module),
            Some(import_meta),
            None,
            Some(node_namespace),
        ];
        let without_configuration_file = WithoutBunTypes {
            has_configuration_file: false,
            incomplete_containers,
            errors_with_bun_types: None,
        };
        let with_configuration_file = WithoutBunTypes {
            has_configuration_file: true,
            incomplete_containers,
            errors_with_bun_types: None,
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
    fn what_had_a_declaration_with_bun_types_stops_no_build_without_them() {
        let missing = WithoutBunTypes {
            has_configuration_file: true,
            incomplete_containers: [None; 4],
            errors_with_bun_types: Some(vec![(b"/a.ts".to_vec(), 7), (b"/b.ts".to_vec(), 3)]),
        };
        let stops_build = |code: u32, path: &[u8], start: u32| {
            let origins = ProgramOrigins {
                files: None,
                origins: &[FileOrigin::ProgramSource],
                project_origin: FileOrigin::NoFile,
                without_bun_types: Some(&missing),
                lacks_installed_bun_types: true,
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
                without_bun_types: None,
                lacks_installed_bun_types: false,
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
            without_bun_types: None,
            lacks_installed_bun_types: false,
        };
        let reported = origins.apply_effects(vec![crate::global(5083, &["a"])]);
        assert_eq!(reported[0].effect, Effect::InternalError);
    }
}
