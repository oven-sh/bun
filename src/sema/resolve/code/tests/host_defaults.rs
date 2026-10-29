use super::*;
use crate::atom::Interner;
use crate::bind::{BindOptions, RuntimeBindOptions};
use crate::file_analysis::{FileInputs, analyze_file};
use crate::fold::{FoldInputs, FoldOptions};
use crate::hir::File;
use crate::import_sites::JsxMode;
use crate::module_format::DeclaredModuleType;
use crate::program::HostLoader;

const MAIN: &[u8] = b"/project/main.js";
const MAIN_TEXT: &[u8] = b"source";

struct Bare;

impl Host for Bare {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        (path == MAIN).then_some(Cow::Borrowed(MAIN_TEXT))
    }

    fn is_file(&self, path: &[u8]) -> bool {
        path == MAIN
    }

    fn is_dir(&self, _path: &[u8]) -> bool {
        false
    }

    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        path.to_vec()
    }

    fn list_dir(&self, _path: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn script_kind(&self, _path: &[u8]) -> Option<ScriptKind> {
        None
    }

    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }

    fn scripts_of_page(&self, _page: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }

    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> File<'s> {
        let mut file = File::empty_in(arena, atoms.session());
        file.is_js = is_javascript(path);
        file.source_len = text.len() as u32;
        file.legacy_decorators = options.experimental_decorators;
        file.finish_nodes();
        file
    }

    fn parse_package_json(&self, _arena: &Arena, text: &[u8]) -> Option<Json> {
        (!text.is_empty()).then(|| Json::String(text.to_vec()))
    }

    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        for index in 0..count {
            work(index);
        }
    }
}

impl CodeHost for Bare {}

fn default_settings() -> TranspileSettings {
    TranspileSettings {
        jsx: JsxSettings::default(),
        experimental_decorators: false,
        emits_decorator_metadata: false,
        use_define_for_class_fields: None,
    }
}

#[test]
fn default_host_claims_no_specifier() {
    for kind in [CodeImportKind::EntryPoint, Import, CodeImportKind::Require] {
        let request = CodeRequest {
            specifier: b"node:fs",
            importer: MAIN,
            directory: b"/project",
            kind,
            form: CodeImportForm::Static,
        };
        assert_eq!(Bare.resolve_code(&request), HostResolution::Unclaimed);
    }
    let unclaimed = Bare.resolve_runtime_module(b"node:fs");
    assert_eq!(unclaimed, HostResolution::Unclaimed);
    assert!(Bare.find_runtime_modules(b"", b"").is_empty());
    assert!(Bare.find_runtime_modules(b"node:", b"").is_empty());
}

#[test]
fn default_host_selects_loader_by_path_alone() {
    let settings = default_settings();
    let loader = Bare.loader_of(&LoaderRequest {
        path: MAIN,
        kind: CodeImportKind::Require,
        type_attribute: Some(b"text"),
        embed_attribute: Some(b"true"),
        settings: &settings,
        declared_module_type: DeclaredModuleType::Unknown,
    });
    assert_eq!(loader, HostLoader(0));
    assert_eq!(loader, HostLoader::default());
}

#[test]
fn default_host_reads_source_at_once() {
    assert!(matches!(Bare.read_code(MAIN), CodeRead::Text(text) if *text == *MAIN_TEXT));
    assert!(matches!(Bare.read_code(b"/missing"), CodeRead::Text(text) if text.is_empty()));
    assert!(Bare.finish_deferred_reads().is_empty());
    assert!(!Bare.is_plugin_source(MAIN));
    assert!(!Bare.is_library_file(MAIN));
    assert!(!Bare.is_evaluated_text(MAIN));
}

#[test]
fn default_host_reads_manifest_like_types_question_and_no_tsconfig() {
    let session = Session::new();
    let arena = session.arena();
    assert_eq!(Bare.parse_runtime_tsconfig(arena, b"{}"), None);
    let strict = Bare.parse_package_json(arena, b"{}");
    assert!(strict.is_some());
    assert_eq!(Bare.parse_runtime_package_json(arena, b"{}"), strict);
    assert_eq!(Bare.parse_runtime_package_json(arena, b""), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn default_host_parses_code_with_parse() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let settings = default_settings();
    let request = CodeParseRequest {
        path: MAIN,
        loader: HostLoader(7),
        options: ParseOptions {
            experimental_decorators: true,
            ..ParseOptions::default()
        },
        reads_jsdoc: true,
        settings: &settings,
        declared_module_type: DeclaredModuleType::Unknown,
    };
    let parsed = Bare.parse_code(session.arena(), &request, MAIN_TEXT, &atoms);
    assert!(parsed.hir.is_js);
    assert!(parsed.hir.legacy_decorators);
    assert_eq!(parsed.hir.source_len as usize, MAIN_TEXT.len());
    assert!(parsed.host_values.is_empty());
    assert!(parsed.payload.is_none());
}

#[test]
#[cfg_attr(miri, ignore)]
fn default_host_leaves_tree_and_payload_unchanged() {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let settings = default_settings();
    let mut hir = Bare.parse(arena, MAIN, b"", &atoms, ParseOptions::default());
    let (bound, analysis) = analyze_file(
        &mut hir,
        BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        },
        &FoldInputs::new(FoldOptions::default(), arena),
        FileInputs {
            declared_module_type: DeclaredModuleType::Unknown,
            import_meta_main: None,
            is_library: false,
            host_values: &[],
            jsx: JsxMode::Classic,
        },
        &atoms,
        arena,
    );
    let mut payload: Option<HostPayload> = None;
    let macros = MacroRequest {
        importer: MAIN,
        hir: &hir,
        bound: &bound,
        analysis: &analysis,
        resolve: &|_| None,
    };
    assert!(
        Bare.run_macros(arena, &atoms, &macros, &mut payload)
            .is_empty()
    );
    let finished = FinishedFile {
        path: MAIN,
        loader: HostLoader::default(),
        hir: &hir,
        bound: &bound,
        analysis: &analysis,
        atoms: &atoms,
        resolutions: &[],
    };
    assert!(Bare.finish_file(&finished, &mut payload).is_empty());
    let mut transform = TransformRequest {
        path: MAIN,
        hir: &mut hir,
        bound: &bound,
        analysis: &analysis,
        settings: &settings,
    };
    let change = Bare.transform_tree(arena, &atoms, &mut transform, &mut payload);
    assert_eq!(change, TreeChange::Unchanged);
    assert!(payload.is_none());
}

#[test]
fn code_host_is_usable_as_host() {
    let code_host: &dyn CodeHost = &Bare;
    let host: &dyn Host = code_host;
    assert!(host.is_file(MAIN));
}
