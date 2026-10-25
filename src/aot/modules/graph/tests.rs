use super::*;
use crate::ir::parallel::run_serially;
use crate::modules::order::OrderParts;
use crate::modules::testing::{file_named, member_named, symbol_named, with_graph};
use crate::modules::{ExportBinding, ImportPhase, ModuleFailureKind};
use bun_sema::hir::{ExprKind, ImportId};
use bun_sema::program::Sym;
use bun_sema::resolve::CodeFailure;
use bun_sema::session::Session;

fn file_module(file: u32) -> ModuleRef {
    ModuleRef::File(FileId(file))
}

fn symbol(file: u32, id: u32) -> Sym {
    Sym {
        file: FileId(file),
        id: SymbolId(id),
    }
}

fn variable(file: u32, id: u32) -> ExportBinding {
    ExportBinding::Variable(symbol(file, id))
}

fn namespace(file: u32) -> ExportBinding {
    ExportBinding::Namespace {
        module: file_module(file),
        phase: ImportPhase::Evaluation,
    }
}

fn export(name: Atom, binding: ExportBinding) -> ModuleExport {
    ModuleExport {
        name,
        binding,
        is_from_star_export: false,
        can_be_ambiguous: false,
        is_read_from_object: true,
    }
}

fn request(target: ModuleRef) -> ModuleRequest {
    ModuleRequest::import(target)
}

fn source_text_file(file: FileId) -> FileRow {
    FileRow {
        file,
        interop: Interop::ES_MODULE,
        runtime_module: None,
        is_library: false,
        has_dynamic_names: false,
        has_top_level_await: false,
        has_no_side_effects: false,
        requests: Vec::new(),
        sites: Vec::new(),
        spellings: Vec::new(),
        imports: Vec::new(),
        members: Vec::new(),
        accessed: Vec::new(),
        fixed_members: Vec::new(),
        named_members: Vec::new(),
        jsx: Vec::new(),
        namespace_values: Vec::new(),
        evaluating_sites: Vec::new(),
        unread_sites: Vec::new(),
        holders: Vec::new(),
        exports: Vec::new(),
        unread_exports: Vec::new(),
        required_names: Vec::new(),
    }
}

fn file_with_sites(file: u32, sites: Vec<(ImportSiteKind, StoredSiteAnswer)>) -> FileRow {
    FileRow {
        sites,
        ..source_text_file(FileId(file))
    }
}

fn unfinished_graph(file_count: usize, rows: Vec<FileRow>) -> ModuleGraph {
    ModuleGraph {
        project: ProjectId::Application,
        row_by_file: vec![None; file_count],
        rows,
        record_files: Vec::new(),
        left_out_files: Vec::new(),
        left_out_inner_modules: Vec::new(),
        other_modules: Vec::new(),
        external_kinds: Vec::new(),
        synthetic_exports: Vec::new(),
        errors: Vec::new(),
        failures: Vec::new(),
        load_failures: Vec::new(),
        wrapped: WrappedModules::default(),
        commonjs_exports: CommonJsExports::default(),
        plan: Plan::new(OrderParts::without_sites(file_count), Vec::new()),
    }
}

fn graph_of(file_count: usize, rows: Vec<FileRow>) -> ModuleGraph {
    unfinished_graph(file_count, rows).finish(&run_serially)
}

fn unresolved_at(importer: u32, site: ImportSiteKind) -> ModuleFailure {
    ModuleFailure {
        kind: ModuleFailureKind::Unresolved {
            specifier: known::default,
            reason: CodeFailure::ModuleNotFound,
        },
        importer: FileId(importer),
        site,
        start: 0,
        end: 0,
    }
}

fn with_require_answer(source: &str, check: impl FnOnce(SiteAnswer<'_>)) {
    let files = [("main.cjs", source), ("other.cjs", "exports.x = 1;\n")];
    with_graph(&files, |graph, input| {
        let main = file_named(input, "main.cjs");
        let mut exprs = input.files.hir(main).exprs.iter();
        let call = exprs.position(|expr| matches!(expr.kind, ExprKind::Call(_)));
        let call = ExprId(call.expect("the file has a call") as u32);
        check(graph.site_answer(main, ImportSiteKind::Require(call)));
    });
}

#[test]
fn graph_is_send_and_sync() {
    fn assert_send_and_sync<T: Send + Sync + 'static>() {}
    assert_send_and_sync::<ModuleGraph>();
}

#[test]
fn find_export_searches_exports_of_one_file() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let [a, b, c] = [b"a", b"b", b"c"].map(|name| atoms.intern(name));
    let first = FileRow {
        exports: vec![export(a, variable(0, 1)), export(c, variable(0, 2))],
        ..source_text_file(FileId(0))
    };
    let second = FileRow {
        exports: vec![
            export(a, variable(2, 1)),
            export(b, namespace(0)),
            export(c, variable(2, 3)),
        ],
        ..source_text_file(FileId(2))
    };
    let graph = graph_of(3, vec![first, second]);
    let find = |file, name| graph.find_export(file_module(file), name, &atoms);
    assert_eq!(find(0, a), ExportLookup::Found(variable(0, 1)));
    assert_eq!(find(0, b), ExportLookup::Absent);
    assert_eq!(find(0, c), ExportLookup::Found(variable(0, 2)));
    assert_eq!(find(2, a), ExportLookup::Found(variable(2, 1)));
    assert_eq!(find(2, b), ExportLookup::Found(namespace(0)));
    assert_eq!(find(2, c), ExportLookup::Found(variable(2, 3)));
    let names = graph.exports(FileId(2)).iter().map(|export| export.name);
    assert_eq!(names.collect::<Vec<_>>(), [a, b, c]);
}

#[test]
fn find_export_searches_by_code_units() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let supplementary = atoms.intern("\u{1F600}".as_bytes());
    let basic = atoms.intern("\u{FF5E}".as_bytes());
    let file = FileRow {
        exports: vec![
            export(supplementary, variable(0, 1)),
            export(basic, variable(0, 2)),
        ],
        ..source_text_file(FileId(0))
    };
    let graph = graph_of(1, vec![file]);
    let find = |name| graph.find_export(file_module(0), name, &atoms);
    assert_eq!(find(supplementary), ExportLookup::Found(variable(0, 1)));
    assert_eq!(find(basic), ExportLookup::Found(variable(0, 2)));
}

#[test]
fn absent_name_is_unknown_with_dynamic_names() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let [present, absent] = [b"a", b"b"].map(|name| atoms.intern(name));
    let file = FileRow {
        has_dynamic_names: true,
        exports: vec![export(present, variable(0, 1))],
        ..source_text_file(FileId(0))
    };
    let graph = graph_of(1, vec![file]);
    let find = |name| graph.find_export(file_module(0), name, &atoms);
    assert_eq!(find(present), ExportLookup::Found(variable(0, 1)));
    assert_eq!(find(absent), ExportLookup::Unknown);
    assert_eq!(find(known::default), ExportLookup::Absent);
}

#[test]
fn possibly_ambiguous_export_is_unknown() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let [ambiguous, single] = [b"a", b"b"].map(|name| atoms.intern(name));
    let star_export = |name, id, can_be_ambiguous| ModuleExport {
        is_from_star_export: true,
        can_be_ambiguous,
        ..export(name, variable(1, id))
    };
    let file = FileRow {
        has_dynamic_names: true,
        exports: vec![
            star_export(ambiguous, 1, true),
            star_export(single, 2, false),
        ],
        ..source_text_file(FileId(0))
    };
    let graph = graph_of(1, vec![file]);
    let find = |name| graph.find_export(file_module(0), name, &atoms);
    assert_eq!(find(ambiguous), ExportLookup::Unknown);
    assert_eq!(find(single), ExportLookup::Found(variable(1, 2)));
}

#[test]
fn absent_es_module_marker_is_unknown() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let exporter = FileRow {
        exports: vec![export(known::__esModule, variable(1, 0))],
        ..source_text_file(FileId(1))
    };
    let files = vec![source_text_file(FileId(0)), exporter];
    let graph = graph_of(2, files);
    let find_marker = |file| graph.find_export(file_module(file), known::__esModule, &atoms);
    assert_eq!(find_marker(0), ExportLookup::Unknown);
    assert_eq!(find_marker(1), ExportLookup::Found(variable(1, 0)));
}

#[test]
fn modules_without_files_have_no_export_table() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let [specifier, name] = [b"p", b"x"].map(|text| atoms.intern(text));
    let runtime = ModuleRef::Runtime(RuntimeModule::NodeFs);
    let external = ModuleRef::External {
        importer: FileId(0),
        specifier,
    };
    let graph = ModuleGraph {
        other_modules: vec![runtime, external],
        external_kinds: vec![((FileId(0), specifier), ExternalKind::HostValue)],
        ..unfinished_graph(0, Vec::new())
    }
    .finish(&run_serially);
    assert_eq!(graph.interop(runtime), Interop::RUNTIME);
    for module in [runtime, external] {
        let export = graph.find_export(module, name, &atoms);
        assert_eq!(export, ExportLookup::Unknown);
    }
    assert_eq!(graph.other_modules(), [runtime, external]);
}

#[test]
fn external_kind_is_found_by_importer_and_specifier() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let [first, second, unused] = [b"a", b"b", b"c"].map(|text| atoms.intern(text));
    let external = |importer, specifier| ModuleRef::External {
        importer: FileId(importer),
        specifier,
    };
    let graph = ModuleGraph {
        external_kinds: vec![
            ((FileId(1), first), ExternalKind::UncompiledCode),
            ((FileId(0), second), ExternalKind::UncompiledCode),
            ((FileId(0), first), ExternalKind::HostValue),
        ],
        ..unfinished_graph(2, Vec::new())
    }
    .finish(&run_serially);
    let host_value = Some(ExternalKind::HostValue);
    let uncompiled_code = Some(ExternalKind::UncompiledCode);
    assert_eq!(graph.external_kind(external(0, first)), host_value);
    assert_eq!(graph.external_kind(external(0, second)), uncompiled_code);
    assert_eq!(graph.external_kind(external(1, first)), uncompiled_code);
    assert_eq!(graph.external_kind(external(1, second)), None);
    assert_eq!(graph.external_kind(external(0, unused)), None);
    assert_eq!(graph.external_kind(file_module(0)), None);
    let runtime = ModuleRef::Runtime(RuntimeModule::NodeFs);
    assert_eq!(graph.external_kind(runtime), None);
    let of_host_value = Interop::of_external(ExternalKind::HostValue);
    assert_eq!(graph.interop(external(0, first)), of_host_value);
    let of_uncompiled_code = Interop::of_external(ExternalKind::UncompiledCode);
    assert_eq!(graph.interop(external(1, first)), of_uncompiled_code);
}

#[test]
fn site_answer_accepts_sites_in_any_order() {
    let [require, erased, import, import_call] = [
        ImportSiteKind::Require(ExprId(9)),
        ImportSiteKind::Import(ImportId(1)),
        ImportSiteKind::Import(ImportId(0)),
        ImportSiteKind::ImportCall(ExprId(4)),
    ];
    let sites = vec![
        (require, StoredSiteAnswer::AllModules),
        (erased, StoredSiteAnswer::Erased),
        (import, StoredSiteAnswer::Module(file_module(1))),
        (import_call, StoredSiteAnswer::Failed(ModuleFailureId(0))),
    ];
    let files = vec![file_with_sites(0, sites), source_text_file(FileId(1))];
    let graph = graph_of(2, files);
    let answer_at = |site| graph.site_answer(FileId(0), site);
    assert_eq!(answer_at(require), SiteAnswer::Computed(Candidates::All));
    assert_eq!(answer_at(erased), SiteAnswer::Erased);
    assert_eq!(answer_at(import), SiteAnswer::Module(file_module(1)));
    let failed = SiteAnswer::Failed(ModuleFailureId(0));
    assert_eq!(answer_at(import_call), failed);
}

#[test]
fn candidates_are_rebased_per_file() {
    let spelled = |spelling, module| SpelledModule {
        spelling: Atom(spelling),
        module,
    };
    let runtime = ModuleRef::Runtime(RuntimeModule::NodeFs);
    let import_call = ImportSiteKind::ImportCall(ExprId(1));
    let require = ImportSiteKind::Require(ExprId(2));
    let sites_of_first = vec![
        (require, StoredSiteAnswer::Candidates(1..2)),
        (import_call, StoredSiteAnswer::Candidates(0..1)),
    ];
    let first = FileRow {
        spellings: vec![spelled(1, file_module(1)), spelled(2, file_module(2))],
        ..file_with_sites(0, sites_of_first)
    };
    let sites_of_second = vec![(import_call, StoredSiteAnswer::Candidates(0..2))];
    let second = FileRow {
        spellings: vec![spelled(1, file_module(0)), spelled(3, runtime)],
        ..file_with_sites(1, sites_of_second)
    };
    let files = vec![first, second, source_text_file(FileId(2))];
    let graph = graph_of(3, files);
    let candidates_at = |file, site| match graph.site_answer(FileId(file), site) {
        SiteAnswer::Computed(Candidates::Modules(modules)) => modules,
        answer => panic!("{site:?} has the answer {answer:?}"),
    };
    assert_eq!(candidates_at(0, import_call), [spelled(1, file_module(1))]);
    assert_eq!(candidates_at(0, require), [spelled(2, file_module(2))]);
    let of_second = [spelled(1, file_module(0)), spelled(3, runtime)];
    assert_eq!(candidates_at(1, import_call), of_second);
}

#[test]
fn computed_site_without_candidates_is_all() {
    let unknown = ImportSiteKind::ImportCall(ExprId(1));
    let matches_nothing = ImportSiteKind::ImportCall(ExprId(2));
    let sites = vec![
        (unknown, StoredSiteAnswer::AllModules),
        (matches_nothing, StoredSiteAnswer::Candidates(0..0)),
    ];
    let graph = graph_of(1, vec![file_with_sites(0, sites)]);
    let answer_at = |site| graph.site_answer(FileId(0), site);
    assert_eq!(answer_at(unknown), SiteAnswer::Computed(Candidates::All));
    let nothing = SiteAnswer::Computed(Candidates::Modules(&[]));
    assert_eq!(answer_at(matches_nothing), nothing);
}

#[test]
fn member_binding_is_found_by_expression() {
    let imported_from = |file| AccessedModule {
        module: file_module(file),
        is_imported: true,
    };
    let first = FileRow {
        members: vec![
            (ExprId(3), ImportBinding::Variable(symbol(1, 0))),
            (ExprId(7), ImportBinding::Synthetic(SyntheticExportId(0))),
        ],
        accessed: vec![(ExprId(3), imported_from(1)), (ExprId(7), imported_from(1))],
        ..source_text_file(FileId(0))
    };
    let second = FileRow {
        members: vec![(ExprId(3), ImportBinding::Variable(symbol(0, 5)))],
        accessed: vec![(ExprId(3), imported_from(0))],
        ..source_text_file(FileId(1))
    };
    let graph = graph_of(2, vec![first, second]);
    let binding_at = |file, member| graph.member_binding(FileId(file), ExprId(member));
    let variable = |file, id| Some(ImportBinding::Variable(symbol(file, id)));
    assert_eq!(binding_at(0, 3), variable(1, 0));
    let synthetic = Some(ImportBinding::Synthetic(SyntheticExportId(0)));
    assert_eq!(binding_at(0, 7), synthetic);
    assert_eq!(binding_at(0, 5), None);
    assert_eq!(binding_at(1, 3), variable(0, 5));
    assert_eq!(binding_at(1, 7), None);
}

#[test]
fn namespace_member_has_member_binding() {
    let files = [
        (
            "main.js",
            "import * as ns from './a.js';\nconst local = { x: 1 };\nconsole.log(ns.a, local.x);\n",
        ),
        ("a.js", "export const a = 1;\n"),
    ];
    with_graph(&files, |graph, input| {
        let (main, exporter) = (file_named(input, "main.js"), file_named(input, "a.js"));
        let member = graph.member_binding(main, member_named(input, main, "a"));
        assert!(matches!(
            member,
            Some(ImportBinding::Variable(symbol)) if symbol.file == exporter
        ));
        let local = graph.member_binding(main, member_named(input, main, "x"));
        assert_eq!(local, None);
    });
}

#[test]
fn jsx_binding_is_found_by_import() {
    let file = FileRow {
        jsx: vec![
            (JsxImport::JsxDev, ImportBinding::Variable(symbol(1, 0))),
            (JsxImport::Fragment, ImportBinding::Variable(symbol(1, 1))),
        ],
        ..source_text_file(FileId(0))
    };
    let graph = graph_of(1, vec![file]);
    let binding_of = |import| graph.jsx_binding(FileId(0), import);
    let variable = |id| ImportBinding::Variable(symbol(1, id));
    assert_eq!(binding_of(JsxImport::JsxDev), variable(0));
    assert_eq!(binding_of(JsxImport::Fragment), variable(1));
}

#[test]
#[should_panic(expected = "a JSX import that is not in use")]
fn jsx_binding_panics_for_unused_import() {
    let graph = graph_of(1, vec![source_text_file(FileId(0))]);
    graph.jsx_binding(FileId(0), JsxImport::Jsx);
}

#[test]
fn lists_are_read_per_file() {
    let name = known::default;
    let required_name = RequiredName::new(file_module(1), name);
    let importer = FileRow {
        requests: vec![request(file_module(1)), request(file_module(3))],
        imports: vec![(SymbolId(4), ImportBinding::Unused)],
        required_names: vec![required_name],
        ..source_text_file(FileId(0))
    };
    let exporter = FileRow {
        requests: vec![request(file_module(3))],
        imports: vec![(SymbolId(4), ImportBinding::Unbound)],
        exports: vec![export(name, variable(1, 0))],
        ..source_text_file(FileId(1))
    };
    let files = vec![importer, exporter, source_text_file(FileId(3))];
    let graph = graph_of(4, files);
    assert_eq!(graph.record_files(), [FileId(0), FileId(1), FileId(3)]);
    let of_importer = [request(file_module(1)), request(file_module(3))];
    assert_eq!(graph.requests(FileId(0)), of_importer);
    assert_eq!(graph.requests(FileId(1)), [request(file_module(3))]);
    assert!(graph.requests(FileId(3)).is_empty());
    let binding_in = |file| graph.import_binding(FileId(file), SymbolId(4));
    assert_eq!(binding_in(0), ImportBinding::Unused);
    assert_eq!(binding_in(1), ImportBinding::Unbound);
    assert_eq!(binding_in(3), ImportBinding::Local);
    assert_eq!(graph.required_names(FileId(0)), [required_name]);
    assert!(graph.required_names(FileId(1)).is_empty());
    assert!(graph.exports(FileId(0)).is_empty());
    assert_eq!(graph.exports(FileId(1)), [export(name, variable(1, 0))]);
}

#[test]
fn file_flags_are_read_per_file() {
    let plain = source_text_file(FileId(0));
    let flagged = FileRow {
        is_library: true,
        has_dynamic_names: true,
        has_top_level_await: true,
        has_no_side_effects: true,
        ..source_text_file(FileId(1))
    };
    let runtime_source = FileRow {
        interop: Interop::RUNTIME_SOURCE,
        runtime_module: Some(RuntimeModule::NodePath),
        ..source_text_file(FileId(2))
    };
    let graph = ModuleGraph {
        project: ProjectId::Runtime,
        ..unfinished_graph(3, vec![plain, flagged, runtime_source])
    }
    .finish(&run_serially);
    assert_eq!(graph.project(), ProjectId::Runtime);
    for (file, expected) in [(FileId(0), false), (FileId(1), true)] {
        assert_eq!(graph.is_library(file), expected);
        assert_eq!(graph.has_dynamic_names(file), expected);
        assert_eq!(graph.has_top_level_await(file), expected);
        assert_eq!(graph.has_no_side_effects(file), expected);
        assert_eq!(graph.kind(file), ModuleKind::SourceText);
        assert_eq!(graph.runtime_module(file), None);
    }
    assert_eq!(graph.kind(FileId(2)), ModuleKind::RuntimeSource);
    assert_eq!(graph.interop(file_module(2)), Interop::RUNTIME_SOURCE);
    let path = Some(RuntimeModule::NodePath);
    assert_eq!(graph.runtime_module(FileId(2)), path);
}

#[test]
fn errors_and_failures_are_separate_lists() {
    let statement = ImportSiteKind::Import(ImportId(0));
    let calls = [1, 2].map(|call| ImportSiteKind::Require(ExprId(call)));
    let synthetic_export = SyntheticExport {
        module: file_module(0),
        name: known::default,
        is_known_member: false,
    };
    let graph = ModuleGraph {
        synthetic_exports: vec![synthetic_export],
        errors: vec![unresolved_at(0, statement)],
        failures: calls.map(|call| unresolved_at(0, call)).to_vec(),
        ..unfinished_graph(1, vec![source_text_file(FileId(0))])
    }
    .finish(&run_serially);
    let error_sites: Vec<ImportSiteKind> = graph.errors().iter().map(|error| error.site).collect();
    assert_eq!(error_sites, [statement]);
    assert_eq!(graph.failures().len(), 2);
    assert_eq!(graph.failure(ModuleFailureId(0)).site, calls[0]);
    assert_eq!(graph.failure(ModuleFailureId(1)).site, calls[1]);
    assert_eq!(graph.synthetic_exports(), [synthetic_export]);
    let first = *graph.synthetic_export(SyntheticExportId(0));
    assert_eq!(first, synthetic_export);
}

#[test]
fn has_record_is_false_for_other_files() {
    let graph = graph_of(2, vec![source_text_file(FileId(1))]);
    assert!(graph.has_record(FileId(1)));
    assert!(!graph.has_record(FileId(0)));
    assert!(!graph.has_record(FileId(2)));
}

#[test]
#[should_panic(expected = "a file without a module record")]
fn reader_panics_for_file_without_record() {
    let graph = graph_of(2, vec![source_text_file(FileId(1))]);
    graph.kind(FileId(0));
}

#[test]
fn local_const_binds_locally() {
    let files = [
        (
            "main.ts",
            "import { a } from './a';\nconst local = a;\nconsole.log(local);\n",
        ),
        ("a.ts", "export const a = 1;\n"),
    ];
    with_graph(&files, |graph, input| {
        let (main, exporter) = (file_named(input, "main.ts"), file_named(input, "a.ts"));
        let binding_of = |name| graph.import_binding(main, symbol_named(input, main, name));
        assert_eq!(binding_of("local"), ImportBinding::Local);
        assert!(matches!(
            binding_of("a"),
            ImportBinding::Variable(symbol) if symbol.file == exporter
        ));
    });
}

#[test]
fn absent_export_follows_module_kind() {
    let files = [
        (
            "main.js",
            "import * as es from './es.js';\nimport * as legacy from './legacy.cjs';\n\
             console.log(es, legacy);\n",
        ),
        ("es.js", "export const present = 1;\n"),
        ("legacy.cjs", "module.exports = { present: 1 };\n"),
    ];
    with_graph(&files, |graph, input| {
        let atoms = &input.files.atoms;
        let find = |file, name: &[u8]| {
            let module = ModuleRef::File(file_named(input, file));
            graph.find_export(module, atoms.intern(name), atoms)
        };
        assert!(matches!(
            find("es.js", b"present"),
            ExportLookup::Found(ExportBinding::Variable(_))
        ));
        assert_eq!(find("es.js", b"absent"), ExportLookup::Absent);
        assert_eq!(find("legacy.cjs", b"present"), ExportLookup::Unknown);
        assert_eq!(find("legacy.cjs", b"absent"), ExportLookup::Unknown);
    });
}

#[test]
fn live_require_targets_file() {
    with_require_answer("require('./other.cjs');\n", |answer| {
        assert!(matches!(answer, SiteAnswer::Module(ModuleRef::File(_))));
    });
}

#[test]
#[should_panic(expected = "no live import site at this node")]
fn dead_require_has_no_site_answer() {
    with_require_answer("if (false) require('./other.cjs');\n", |_| {});
}
