use super::*;
use crate::bind::BoundBuilder;
use crate::fold::{Constant, Decision};
use crate::hir_from_data::DataValue;
use crate::module_format::ModuleFormat;
use crate::program::code_test_host::TEXT_LOADER;
use crate::resolve::{EnclosingPackage, ExternalKind};

const LARGE_STACK_BYTES: usize = 64 << 20;
const NESTING_DEPTH: usize = 200_000;

const MACRO_FILES: &[(&str, &str)] = &[
    (
        "/p/a.ts",
        "import m from \"./m\" with { type: \"macro\" }\nm(\"a\")\nm(\"b\")",
    ),
    ("/p/m.ts", ""),
];

fn macro_host(max_macro_values: usize) -> StatementsHost {
    StatementsHost {
        max_macro_values,
        ..host_of(MACRO_FILES)
    }
}

fn ran_macros(pending_calls: usize) -> HostEvent {
    HostEvent::RanMacros { pending_calls }
}

fn transformed(path: &str) -> HostEvent {
    HostEvent::TransformedTree(path.into())
}

fn macro_and_transform_events(host: &StatementsHost) -> Vec<HostEvent> {
    let mut events = host.events();
    events.retain(|event| match event {
        HostEvent::RanMacros { .. } | HostEvent::TransformedTree(_) => true,
        _ => false,
    });
    events
}

fn settings_with(
    experimental_decorators: bool,
    emits_decorator_metadata: bool,
) -> TranspileSettings {
    TranspileSettings {
        jsx: JsxSettings::default(),
        experimental_decorators,
        emits_decorator_metadata,
        use_define_for_class_fields: None,
    }
}

#[test]
fn file_without_module_syntax_is_module_by_decree() {
    let host = host_of(&[
        ("/p/plain.ts", "a"),
        ("/p/meta.ts", "import.meta"),
        ("/p/import.ts", "import \"./plain\""),
    ]);
    with_context(&host, |context| {
        let marks = |path| {
            let hir = load(context, path).parse.hir;
            (hir.has_module_syntax, hir.is_forced_module)
        };
        assert_eq!(marks("/p/plain.ts"), (true, true));
        assert_eq!(marks("/p/meta.ts"), (true, false));
        assert_eq!(marks("/p/import.ts"), (true, false));
    });
}

#[test]
fn declaration_tree_is_not_marked_as_module() {
    let session = Session::new();
    let mut hir = hir::File::empty_in(session.arena(), &session);
    hir.kind = FileKind::Declaration;
    mark_as_module(&mut hir);
    assert!(!hir.has_module_syntax);
    assert!(!hir.is_forced_module);
}

#[test]
fn plugin_source_declares_no_module_type() {
    let host = StatementsHost {
        plugin_sources: &["/p/plugin.cjs"],
        ..host_of(&[("/p/disk.cjs", "a"), ("/p/plugin.cjs", "a")])
    };
    with_context(&host, |context| {
        let disk = load(context, "/p/disk.cjs");
        let disk = &disk.code.analyzed;
        assert_eq!(disk.declared_module_type, DeclaredModuleType::CommonJs);
        assert_eq!(disk.analysis.module_format, ModuleFormat::CommonJs);

        let plugin = load(context, "/p/plugin.cjs");
        let plugin = &plugin.code.analyzed;
        assert_eq!(plugin.declared_module_type, DeclaredModuleType::Unknown);
        assert_eq!(plugin.analysis.module_format, ModuleFormat::Esm);
    });
}

#[test]
fn either_decorator_setting_selects_legacy_decorators_in_typescript() {
    let cases = [
        (false, false, false),
        (true, false, true),
        (false, true, true),
        (true, true, true),
    ];
    with_context(&host_of(&[]), |context| {
        for (experimental_decorators, emits_metadata, expected) in cases {
            let settings = settings_with(experimental_decorators, emits_metadata);
            let typescript = parse_options_of(context, b"/p/a.ts", &settings);
            assert_eq!(typescript.experimental_decorators, expected, "{settings:?}");
            let javascript = parse_options_of(context, b"/p/a.js", &settings);
            assert!(!javascript.experimental_decorators, "{settings:?}");
        }
    });
}

#[test]
fn parser_needs_no_module_indicator() {
    with_context(&host_of(&[]), |context| {
        assert_eq!(
            context.options.for_parsing().module_detection,
            ModuleDetection::Auto
        );
        let options = parse_options_of(context, b"/p/a.ts", &settings_with(false, false));
        assert_eq!(options.module_detection, ModuleDetection::Force);
    });
}

#[test]
fn decorator_metadata_of_config_reaches_parser() {
    let host = host_of(&[
        ("/p/tsconfig.json", "emitDecoratorMetadata"),
        ("/p/a.ts", "a"),
        ("/p/a.js", "a"),
        ("/q/a.ts", "a"),
    ]);
    with_context(&host, |context| {
        let with_metadata = load(context, "/p/a.ts");
        assert!(
            with_metadata
                .code
                .analyzed
                .settings
                .emits_decorator_metadata
        );
        assert!(!with_metadata.code.analyzed.settings.experimental_decorators);
        assert!(with_metadata.parse.hir.legacy_decorators);
        assert!(!load(context, "/p/a.js").parse.hir.legacy_decorators);
        assert!(!load(context, "/q/a.ts").parse.hir.legacy_decorators);
    });
}

#[test]
fn macro_rounds_end_when_host_has_no_other_value() {
    let cases = [
        (0, vec![ran_macros(2), transformed("/p/a.ts")], 2),
        (
            1,
            vec![ran_macros(2), ran_macros(1), transformed("/p/a.ts")],
            1,
        ),
        (
            2,
            vec![ran_macros(2), ran_macros(1), transformed("/p/a.ts")],
            0,
        ),
        (
            9,
            vec![ran_macros(2), ran_macros(1), transformed("/p/a.ts")],
            0,
        ),
    ];
    for (max_macro_values, events, pending_count) in cases {
        let host = macro_host(max_macro_values);
        with_context(&host, |context| {
            let analysis = load(context, "/p/a.ts").code.analyzed.analysis;
            let pending = analysis.pending_macro_calls;
            assert_eq!(pending.len(), pending_count, "{max_macro_values} values");
        });
        assert_eq!(
            macro_and_transform_events(&host),
            events,
            "{max_macro_values} values"
        );
    }
}

#[test]
fn macro_value_decides_call() {
    with_context(&macro_host(1), |context| {
        let parsed = load(context, "/p/a.ts");
        let hir = &parsed.parse.hir;
        let calls: Vec<ExprId> = (0..hir.exprs.len() as u32)
            .map(ExprId)
            .filter(|&e| matches!(hir[e].kind, ExprKind::Call(_)))
            .collect();
        assert_eq!(calls.len(), 2);
        let analysis = &parsed.code.analyzed.analysis;
        let answered = analysis.decisions.decision(calls[0]);
        assert_eq!(answered, Decision::Constant(Constant::Null));
        assert_eq!(analysis.decisions.decision(calls[1]), Decision::Unknown);
        assert_eq!(analysis.pending_macro_calls, [calls[1]]);
    });
}

#[test]
fn file_without_macro_call_runs_no_macro() {
    let host = StatementsHost {
        max_macro_values: 9,
        ..host_of(&[("/p/plain.ts", "m(\"a\")")])
    };
    with_context(&host, |context| {
        load(context, "/p/plain.ts");
    });
    assert_eq!(
        macro_and_transform_events(&host),
        [transformed("/p/plain.ts")]
    );
}

#[test]
fn changed_tree_is_analyzed_once_more() {
    let unchanged = macro_host(0);
    with_context(&unchanged, |context| {
        load(context, "/p/a.ts");
    });
    let events = macro_and_transform_events(&unchanged);
    assert_eq!(events, [ran_macros(2), transformed("/p/a.ts")]);

    let changed = StatementsHost {
        transformed: &["/p/a.ts"],
        ..macro_host(0)
    };
    with_context(&changed, |context| {
        load(context, "/p/a.ts");
    });
    let events = macro_and_transform_events(&changed);
    assert_eq!(
        events,
        [ran_macros(2), transformed("/p/a.ts"), ran_macros(2)]
    );
}

fn run_on_large_stack(test: impl FnOnce() + Send) {
    std::thread::scope(|scope| {
        let thread = std::thread::Builder::new().stack_size(LARGE_STACK_BYTES);
        let running = thread.spawn_scoped(scope, test).expect("the thread starts");
        if let Err(panic) = running.join() {
            std::panic::resume_unwind(panic);
        }
    });
}

#[test]
fn binder_stack_overflow_replaces_tree_with_empty_tree() {
    run_on_large_stack(|| {
        let host = host_of(&[]);
        let (open, close) = ("{ a: ".repeat(NESTING_DEPTH), " }".repeat(NESTING_DEPTH));
        let text = format!("import(\"./b\")\nf(\"s\", {open}\"x\"{close})");
        with_context(&host, |context| {
            let target = CodeTarget::of_path(b"/p/deep.ts", HostLoader::default());
            let source = Cow::Owned(text.clone().into_bytes());
            let parsed =
                load_code_file(context, context.session.arena(), target, source, false, &[]);
            let hir = &parsed.parse.hir;
            assert!(hir.ran_out_of_stack && hir.has_errors && hir.has_parse_diagnostics);
            assert!(hir.body.is_empty());
            assert!(hir.exprs.is_empty());
            assert!(hir.has_module_syntax);
            assert_eq!(hir.source_len as usize, text.len());
            assert_eq!(hir.text[..], *text.as_bytes());
            assert!(!parsed.parse.bound.ran_out_of_stack);
            assert!(parsed.code.analyzed.analysis.import_sites.is_empty());
            assert!(parsed.code.targets.is_empty());
            assert_eq!(
                *downcast_payload(&parsed.payload),
                parse_payload("/p/deep.ts", false)
            );
        });
        assert_eq!(parsed_paths(&host), ["/p/deep.ts", "/p/deep.ts"]);
        assert!(macro_and_transform_events(&host).is_empty());
    });
}

fn main_answer(
    host: &StatementsHost,
    entry_points: &[&str],
    path: &str,
    loader: HostLoader,
) -> Option<bool> {
    with_compile_context(&TestBuild::new(host, entry_points), |context| {
        let path = path.as_bytes();
        import_meta_main(context, LoadKey { path, loader })
    })
}

#[test]
fn only_entry_point_is_main_module() {
    let host = host_of(&[]);
    let main_of =
        |entry_points: &[&str], path| main_answer(&host, entry_points, path, HostLoader::default());
    assert_eq!(main_of(&["/a.ts"], "/a.ts"), Some(true));
    assert_eq!(main_of(&["/a.ts"], "/b.ts"), Some(false));
    assert_eq!(main_of(&["/a.ts", "/b.ts"], "/a.ts"), None);
    assert_eq!(main_of(&["/a.ts", "/b.ts"], "/b.ts"), None);
    assert_eq!(main_of(&["/a.ts", "/b.ts"], "/c.ts"), Some(false));
    assert_eq!(main_of(&[], "/a.ts"), Some(false));
}

#[test]
fn entry_point_loaded_with_other_loader_is_not_main_module() {
    let host = StatementsHost {
        loaders: &[("/a.txt", None, TEXT_LOADER)],
        ..host_of(&[])
    };
    assert_eq!(
        main_answer(&host, &["/a.txt"], "/a.txt", TEXT_LOADER),
        Some(true)
    );
    let as_code = main_answer(&host, &["/a.txt"], "/a.txt", HostLoader::default());
    assert_eq!(as_code, Some(false));
}

#[test]
fn entry_point_spelling_follows_case_rule_of_host() {
    let sensitive = host_of(&[]);
    let insensitive = StatementsHost {
        is_case_sensitive: false,
        ..host_of(&[])
    };
    let loader = HostLoader::default();
    assert_eq!(
        main_answer(&sensitive, &["/A.ts"], "/a.ts", loader),
        Some(false)
    );
    assert_eq!(
        main_answer(&insensitive, &["/A.ts"], "/a.ts", loader),
        Some(true)
    );
}

fn folded_main_read(entry_points: &[&str], path: &str) -> Option<bool> {
    let host = host_of(&[("/a.ts", "import.meta.main"), ("/b.ts", "import.meta.main")]);
    with_compile_context(&TestBuild::new(&host, entry_points), |context| {
        let parsed = load(context, path);
        let read = ExprId(parsed.parse.hir.exprs.len() as u32 - 1);
        match parsed.code.analyzed.analysis.decisions.decision(read) {
            Decision::Constant(Constant::Boolean(is_main)) => Some(is_main),
            Decision::Unknown => None,
            decision => panic!("{decision:?} does not answer `import.meta.main`"),
        }
    })
}

#[test]
fn main_module_answer_reaches_fold() {
    assert_eq!(folded_main_read(&["/a.ts"], "/a.ts"), Some(true));
    assert_eq!(folded_main_read(&["/a.ts"], "/b.ts"), Some(false));
    assert_eq!(folded_main_read(&["/a.ts", "/b.ts"], "/a.ts"), None);
}

#[test]
fn host_values_of_data_module_reach_fold() {
    let host = host_of(&[("/p/data.txt", "hello")]);
    with_context(&host, |context| {
        let parsed = load_with_loader(context, "/p/data.txt", TEXT_LOADER);
        let hir = &parsed.parse.hir;
        let statement = hir
            .ids(hir.body)
            .next()
            .expect("the module has a statement");
        let StmtKind::ExportDefault(value) = hir[statement].kind else {
            panic!("the module exports a default value");
        };
        let text = context.atoms.intern(b"hello");
        let decision = parsed.code.analyzed.analysis.decisions.decision(value);
        assert_eq!(decision, Decision::Constant(Constant::String(text)));
    });
}

#[test]
fn enclosing_package_is_recorded() {
    let host = host_of(&[
        ("/p/a.ts", "a"),
        ("/p/node_modules/pkg/package.json", "pkg@1.0.0"),
        ("/p/node_modules/pkg/lib/index.js", "a"),
    ]);
    with_context(&host, |context| {
        assert_eq!(load(context, "/p/a.ts").code.analyzed.package, None);
        let package = load(context, "/p/node_modules/pkg/lib/index.js")
            .code
            .analyzed
            .package;
        let expected = EnclosingPackage {
            directory: b"/p/node_modules/pkg",
            name: b"pkg",
            version: b"1.0.0",
        };
        assert_eq!(package, Some(expected));
    });
}

#[test]
fn jsx_mode_follows_settings() {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let classic = JsxSettings {
        runtime: JsxRuntime::Classic,
        ..JsxSettings::default()
    };
    assert_eq!(jsx_mode_of(&classic, &atoms), JsxMode::Classic);

    for (is_development, runtime_specifier) in [
        (true, &b"preact/jsx-dev-runtime"[..]),
        (false, &b"preact/jsx-runtime"[..]),
    ] {
        let automatic = JsxSettings {
            is_development,
            import_source: b"preact".to_vec(),
            ..JsxSettings::default()
        };
        let expected = JsxMode::Automatic(AutomaticJsx {
            runtime_specifier: atoms.intern(runtime_specifier),
            package_specifier: atoms.intern(b"preact"),
            is_development,
        });
        assert_eq!(jsx_mode_of(&automatic, &atoms), expected);
    }
}

#[test]
fn macro_import_resolves_to_disk_file_only() {
    let module = HostModuleId(1);
    let path = || b"/p/macro.ts".to_vec();
    let host = StatementsHost {
        claims: vec![
            ("claimed-path", HostResolution::Path(path())),
            (
                "claimed-source",
                HostResolution::ModuleSource {
                    module,
                    path: path(),
                },
            ),
            ("claimed-module", HostResolution::Module(module)),
            (
                "claimed-external",
                HostResolution::External {
                    specifier: b"claimed-external".to_vec(),
                    kind: ExternalKind::UncompiledCode,
                },
            ),
            ("claimed-erased", HostResolution::Erased),
        ],
        ..host_of(&[("/p/a.ts", ""), ("/p/macro.ts", "")])
    };
    with_context(&host, |context| {
        let resolve = |specifier: &[u8]| resolve_macro_import(context, b"/p/a.ts", specifier);
        assert_eq!(resolve(b"./macro.ts"), Some(path()));
        assert_eq!(resolve(b"./macro"), Some(path()));
        assert_eq!(resolve(b"./missing.ts"), None);
        for (specifier, _) in &host.claims {
            assert_eq!(resolve(specifier.as_bytes()), None, "{specifier}");
        }
    });
}

fn add_class_with_private_field(file: &mut FileBuilder, name: Atom) -> ClassId {
    let field = Member {
        kind: MemberKind::Property,
        key: PropKey::Private(name),
        flags: Flags::empty(),
        ty: TypeNodeId::NONE,
        init: ExprId::NONE,
        func: FnId::NONE,
        name_pos: 0,
        start: 0,
        loc: TextRange::default(),
        modifiers: Span::EMPTY,
    };
    let members = file.add_members(&[field]);
    file.add_class(Class {
        name: Atom::NONE,
        name_pos: 0,
        flags: Flags::empty(),
        type_params: Span::EMPTY,
        extends: ExprId::NONE,
        extends_args: IdList::EMPTY,
        other_extends: IdList::EMPTY,
        implements: IdList::EMPTY,
        other_implements: IdList::EMPTY,
        members,
        start: 0,
        text_start: 0,
        modifiers: Span::EMPTY,
    })
}

struct RenamedNames {
    outer_field: Vec<u8>,
    inner_field: Vec<u8>,
    reference: Vec<u8>,
}

fn rename_heritage_reference(
    find_class: fn(outer: ClassId, inner: ClassId) -> Option<ClassId>,
) -> RenamedNames {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let name = atoms.intern(b"#a");
    let mut file = FileBuilder::default();
    let outer = add_class_with_private_field(&mut file, name);
    let inner = add_class_with_private_field(&mut file, name);
    let object = file.expr(ExprKind::Ident(atoms.intern(b"o")), 0, 0);
    let member = file.dot((object, Chain::No), (name, 0), 0);
    let reference = file.expr(member, 0, 0);
    let (mut hir, _) = file.into_arena(arena, &session);
    let mut bound = BoundBuilder::default();
    bound.private_class.insert(reference, inner);
    let bound = bound.into_arena(arena);
    rename_private_names_with(&mut hir, &bound, &atoms, b"/p/a.js", |e, class| {
        assert_eq!((e, class), (reference, inner));
        find_class(outer, inner)
    });
    let field_name = |class: ClassId| match hir[hir[class].members.at(0)].key {
        PropKey::Private(name) => atoms.bytes(name).to_vec(),
        key => panic!("{key:?} is not a private name"),
    };
    let ExprKind::Dot { name, .. } = hir[reference].kind else {
        panic!("the reference is a member access");
    };
    RenamedNames {
        outer_field: field_name(outer),
        inner_field: field_name(inner),
        reference: atoms.bytes(name).to_vec(),
    }
}

#[test]
fn private_reference_is_spelled_like_field_of_found_class() {
    let names = rename_heritage_reference(|_, inner| Some(inner));
    assert_ne!(names.outer_field, names.inner_field);
    assert_eq!(names.reference, names.inner_field);

    let names = rename_heritage_reference(|outer, _| Some(outer));
    assert_ne!(names.outer_field, names.inner_field);
    assert_eq!(names.reference, names.outer_field);
}

#[test]
fn private_reference_without_class_keeps_written_name() {
    let names = rename_heritage_reference(|_, _| None);
    assert_eq!(names.reference, b"#a");
    assert_ne!(names.outer_field, b"#a");
    assert_ne!(names.inner_field, b"#a");
}

fn host_values<'s>(
    ids: &[u32],
    value: &'s DataValue<'s>,
    arena: &'s Arena,
) -> &'s [(ExprId, HostValue<'s>)] {
    let values: Vec<(ExprId, HostValue<'s>)> = (ids.iter())
        .map(|&id| (ExprId(id), HostValue::Data(value)))
        .collect();
    slice_in(&values, arena)
}

fn ids_of(values: &[(ExprId, HostValue<'_>)]) -> Vec<u32> {
    values.iter().map(|value| value.0.0).collect()
}

#[test]
fn disjoint_host_values_interleave_in_order() {
    let session = Session::new();
    let arena = session.arena();
    let known = host_values(&[1, 4, 9], &DataValue::Null, arena);
    let added = host_values(&[2, 3, 10], &DataValue::Null, arena);
    assert_eq!(
        ids_of(merge_host_values(known, added, arena)),
        [1, 2, 3, 4, 9, 10]
    );
    assert_eq!(
        ids_of(merge_host_values(added, known, arena)),
        [1, 2, 3, 4, 9, 10]
    );
    assert_eq!(ids_of(merge_host_values(&[], added, arena)), [2, 3, 10]);
}

#[test]
fn repeated_expression_keeps_known_host_value() {
    let session = Session::new();
    let arena = session.arena();
    let known = host_values(&[1, 5], &DataValue::Null, arena);
    let added = host_values(&[1, 3, 5], &DataValue::Undefined, arena);
    let merged = merge_host_values(known, added, arena);
    assert_eq!(ids_of(merged), [1, 3, 5]);
    let are_known: Vec<bool> = (merged.iter())
        .map(|value| value.1 == HostValue::Data(&DataValue::Null))
        .collect();
    assert_eq!(are_known, [true, false, true]);

    let repeated = host_values(&[5], &DataValue::Undefined, arena);
    assert_eq!(merge_host_values(known, repeated, arena), known);
}

#[test]
fn merge_without_added_value_returns_known_slice() {
    let session = Session::new();
    let arena = session.arena();
    let known = host_values(&[1, 5], &DataValue::Null, arena);
    assert!(std::ptr::eq(merge_host_values(known, &[], arena), known));
}
