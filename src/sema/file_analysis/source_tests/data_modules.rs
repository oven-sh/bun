mod support;
use support::*;

const DEPTH: usize = 100_000;

const MARKED_DEFAULT: &[&str] = &["__esModule", "default"];

const JSON_TREES: &[(Data<'static>, &[&str])] = &[
    (
        Data::Object(&[
            (
                "a",
                Data::Array(&[
                    Data::Number(1.0),
                    Data::Number(-2.0),
                    Data::Number(0.5),
                    Data::String("b"),
                    Data::Boolean(true),
                    Data::Boolean(false),
                    Data::Null,
                    Data::Object(&[("c", Data::Object(&[]))]),
                ]),
            ),
            ("d", Data::String("e")),
        ]),
        &["a", "d", "default"],
    ),
    (Data::Array(&[]), MARKED_DEFAULT),
    (Data::Object(&[]), &["default"]),
    (Data::String("s"), MARKED_DEFAULT),
    (Data::Number(-0.0), MARKED_DEFAULT),
    (Data::Number(1000.0), MARKED_DEFAULT),
    (Data::Null, MARKED_DEFAULT),
];

const KEYED_OBJECT: Data<'static> = Data::Object(&[
    ("a", Data::Number(1.0)),
    ("b-c", Data::Number(2.0)),
    ("default", Data::Number(3.0)),
    ("_0", Data::Number(4.0)),
    ("0", Data::Number(5.0)),
    ("__proto__", Data::Number(6.0)),
]);

const EXPORTED_KEYS: [&str; 6] = ["0", "_0", "__proto__", "a", "b-c", "default"];

const VALUES_WITHOUT_KEYS: &[Data<'static>] = &[
    Data::Array(&[Data::Number(1.0)]),
    Data::Null,
    Data::Number(7.0),
    Data::String("s"),
];

fn module<'s>(w: &Workspace<'s>, module: &DataModule<'s>) -> DataModuleTree<'s> {
    let tree = module_from_data(module, &w.atoms, w.arena);
    let hir = &tree.file;
    assert_eq!(hir.source_len, 0);
    assert!(hir.text.is_empty());
    assert!(hir.exprs.iter().all(|expr| expr.pos == 0 && expr.end == 0));
    assert!(hir.stmts.iter().all(|stmt| stmt.start == 0));
    assert!(hir.diagnostics.is_empty());
    assert!(hir.comments.is_empty());
    assert!(hir.specifier_uses.is_empty());
    assert_eq!(hir.expr_flags.len(), hir.exprs.len());
    assert!(tree.host_values.is_sorted_by_key(|entry| entry.0));
    tree
}

fn analyze<'s>(w: &Workspace<'s>, tree: DataModuleTree<'s>) -> Analyzed<'s> {
    let DataModuleTree {
        file: mut hir,
        host_values,
    } = tree;
    let fold = w.fold_inputs(&Fold::NONE);
    let source = Source::new("data.js", "");
    let (bound, analysis) = w.analyze_tree(&mut hir, &source, &fold, host_values);
    Analyzed {
        workspace: *w,
        hir,
        bound,
        analysis,
    }
}

fn analyzed_module<'s>(w: &Workspace<'s>, data: &DataModule<'s>) -> Analyzed<'s> {
    analyze(w, module(w, data))
}

#[track_caller]
fn analyzed_root<'s>(w: &Workspace<'s>, data: &DataModule<'s>) -> (Analyzed<'s>, ExprId) {
    let tree = module(w, data);
    let [(root, _)] = *tree.host_values else {
        panic!("host values: {:?}", tree.host_values);
    };
    (analyze(w, tree), root)
}

fn exports(s: &Analyzed<'_>) -> Vec<String> {
    let file = s.bound.symbol(s.bound.file_symbol);
    let mut names: Vec<String> = s
        .bound
        .table(file.exports)
        .iter()
        .map(|&(name, _)| s.workspace.text(name).to_owned())
        .collect();
    names.sort();
    names
}

#[track_caller]
fn export_default_value(hir: &File<'_>) -> ExprId {
    let statements = find_stmts(hir, |kind| matches!(kind, StmtKind::ExportDefault(_)));
    let [statement] = statements[..] else {
        panic!("export default statements: {statements:?}");
    };
    let StmtKind::ExportDefault(value) = hir[statement].kind else {
        panic!("statement: {:?}", hir[statement].kind);
    };
    value
}

#[track_caller]
fn number_at(hir: &File<'_>, expr: ExprId) -> f64 {
    let ExprKind::Number(index) = hir[expr].kind else {
        panic!("not a number: {:?}", hir[expr].kind);
    };
    hir.numbers[index as usize]
}

#[track_caller]
fn negated_number(hir: &File<'_>, expr: ExprId) -> f64 {
    let ExprKind::Unary {
        op: UnOp::Minus,
        operand,
    } = hir[expr].kind
    else {
        panic!("not a negation: {:?}", hir[expr].kind);
    };
    number_at(hir, operand)
}

fn value_module<'s>(w: &Workspace<'s>, value: &Data<'_>, exports_keys: bool) -> Analyzed<'s> {
    let default = w.data(value);
    analyzed_module(
        w,
        &DataModule::Value {
            default,
            exports_keys,
        },
    )
}

#[track_caller]
fn leaf<'s>(w: &Workspace<'s>, value: Data<'_>) -> Analyzed<'s> {
    let s = value_module(w, &value, false);
    assert_eq!(exports(&s), ["default"]);
    s
}

#[track_caller]
fn first_declared_symbol(s: &Analyzed<'_>) -> SymbolId {
    let statement = s.hir.ids(s.hir.body).next();
    let Some(StmtKind::Var(declarations)) = statement.map(|id: StmtId| s.hir[id].kind) else {
        panic!("first statement: {statement:?}");
    };
    let pat = s.hir.var_decls[declarations.range()][0].pat;
    s.bound.declared_symbol(Decl::Var(pat))
}

#[track_caller]
fn exported_binding_of(s: &Analyzed<'_>, name: Atom) -> Binding {
    let found = (0u32..)
        .zip(s.hir.export_specs.iter())
        .find(|(_, spec)| spec.exported == name);
    let Some((index, _)) = found else {
        panic!("no export named {}", s.workspace.text(name));
    };
    s.bound.exported_binding(ExportSpecId::from(index))
}

fn export_pairs<'a>(s: &'a Analyzed<'_>) -> Vec<(&'a str, &'a str)> {
    let (w, specs) = (&s.workspace, s.hir.export_specs.iter());
    specs
        .map(|spec| (w.text(spec.local), w.text(spec.exported)))
        .collect()
}

#[track_caller]
fn declared_names<'a>(s: &'a Analyzed<'_>) -> Vec<&'a str> {
    let declarations = s.hir.var_decls.iter();
    let names = declarations.map(|declaration| match s.hir[declaration.pat].kind {
        PatKind::Ident(name) => s.workspace.text(name),
        kind => panic!("declared pattern: {kind:?}"),
    });
    names.collect()
}

fn index_reads(hir: &File<'_>) -> Vec<ExprId> {
    find_exprs(hir, |kind| matches!(kind, ExprKind::Index { .. }))
}

fn exprs_resolved_at_runtime(hir: &File<'_>) -> Vec<ExprId> {
    let exprs = (0..hir.exprs.len() as u32).map(ExprId);
    let is_flagged = |e: &ExprId| hir.expr_flags(*e).contains(ExprFlags::RESOLVED_AT_RUNTIME);
    exprs.filter(is_flagged).collect()
}

fn is_computed(hir: &File<'_>, e: ExprId) -> bool {
    matches!(
        hir[e].kind,
        ExprKind::Unary { .. } | ExprKind::Array(_) | ExprKind::Object(_)
    )
}

#[test]
fn json_exports_keys() {
    for (value, names) in JSON_TREES {
        with_workspace(|w| {
            let default = w.data(value);
            let data = DataModule::Value {
                default,
                exports_keys: true,
            };
            let (s, root) = analyzed_root(w, &data);
            assert_eq!(exports(&s), *names, "{value:?}");
            assert_eq!(s.analysis.module_format, ModuleFormat::Esm, "{value:?}");
            let expected = Decision::of_data(default);
            assert_eq!(s.analysis.decisions.decision(root), expected, "{value:?}");
        });
    }
}

#[test]
fn proto_key_is_own_property() {
    with_workspace(|w| {
        let value = Data::Object(&[("__proto__", Data::Number(1.0)), ("a", Data::Null)]);
        for (exports_keys, names) in [
            (false, &["default"][..]),
            (true, &["__proto__", "a", "default"]),
        ] {
            let s = value_module(w, &value, exports_keys);
            assert_eq!(s.hir.props.len(), 2);
            assert_eq!(s.hir.props[1].name_kind, NameKind::StringLiteral);
            assert!(!s.hir.props.iter().any(is_proto_setter));
            let property = s.hir.props[0];
            assert_eq!(property.kind, PropKind::Init);
            assert_eq!(property.key, PropKey::Name(known::__proto__));
            assert_eq!(property.name_kind, NameKind::ComputedString);
            assert_eq!(
                number_at(&s.hir, property.value).to_bits(),
                1.0f64.to_bits()
            );
            assert_eq!(exports(&s), names);
        }
    });
}

#[test]
fn leaves() {
    with_workspace(|w| {
        let s = leaf(w, Data::Undefined);
        let value = export_default_value(&s.hir);
        let ExprKind::Unary {
            op: UnOp::Void,
            operand,
        } = s.hir[value].kind
        else {
            panic!("undefined: {:?}", s.hir[value].kind);
        };
        assert_eq!(number_at(&s.hir, operand).to_bits(), 0.0f64.to_bits());

        for (number, operand) in [(-0.0, 0.0), (-1.5, 1.5), (f64::NEG_INFINITY, f64::INFINITY)] {
            let s = leaf(w, Data::Number(number));
            let found = negated_number(&s.hir, export_default_value(&s.hir));
            assert_eq!(found.to_bits(), f64::to_bits(operand), "{number}");
        }

        for number in [0.0f64, 1.5, f64::INFINITY, f64::NAN, -f64::NAN] {
            let s = leaf(w, Data::Number(number));
            let found = number_at(&s.hir, export_default_value(&s.hir));
            assert_eq!(found.to_bits(), number.to_bits(), "{number}");
        }

        let s = leaf(w, Data::BigInt("10"));
        let value = export_default_value(&s.hir);
        let ExprKind::BigInt(digits) = s.hir[value].kind else {
            panic!("bigint: {:?}", s.hir[value].kind);
        };
        assert_eq!(digits, w.atom("10"));
    });
}

#[test]
fn keys_are_exported() {
    with_workspace(|w| {
        let s = value_module(w, &KEYED_OBJECT, true);
        assert_eq!(exports(&s), EXPORTED_KEYS);
        assert_eq!(s.analysis.module_format, ModuleFormat::Esm);
        let objects = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Object(_)));
        assert_eq!(objects.len(), 1);

        let first = first_declared_symbol(&s);
        let reads = index_reads(&s.hir);
        assert_eq!(reads.len(), 5);
        for read in reads {
            let ExprKind::Index { obj, .. } = s.hir[read].kind else {
                panic!("read: {:?}", s.hir[read].kind);
            };
            assert!(matches!(s.hir[obj].kind, ExprKind::Ident(_)));
            assert_eq!(s.bound.binding(obj), Binding::Symbol(first));
        }

        for key in EXPORTED_KEYS {
            let atom = w.atom(key);
            let is_key = |pat: &Pat| matches!(pat.kind, PatKind::Ident(name) if name == atom);
            assert!(!s.hir.pats.iter().any(is_key), "local named {key}");
        }
        let default = exported_binding_of(&s, known::default);
        assert_eq!(default, Binding::Symbol(first));
    });
}

#[test]
fn other_values_export_default_and_marker() {
    with_workspace(|w| {
        for value in VALUES_WITHOUT_KEYS {
            let s = value_module(w, value, true);
            assert_eq!(exports(&s), ["__esModule", "default"]);
            assert_eq!(s.hir.body.len(), 2, "{value:?}");
            let expected = [("_0", "default"), ("_1", "__esModule")];
            assert_eq!(export_pairs(&s), expected, "{value:?}");
            assert_eq!(declared_names(&s), ["_0", "_1"], "{value:?}");
            let marker = s.hir[s.hir.var_decls[1].init].kind;
            assert!(matches!(marker, ExprKind::True), "marker: {marker:?}");
        }
        let s = value_module(w, &KEYED_OBJECT, false);
        assert_eq!(exports(&s), ["default"]);
    });
}

#[test]
fn empty_object_exports_default() {
    with_workspace(|w| {
        for value in [Data::Object(&[]), Data::Object(&[("default", Data::Null)])] {
            let s = value_module(w, &value, true);
            assert_eq!(exports(&s), ["default"]);
            assert!(index_reads(&s.hir).is_empty());
            assert_eq!(s.hir.body.len(), 2);
            assert_eq!(s.hir.var_decls.len(), 1);
            assert_eq!(s.analysis.module_format, ModuleFormat::Esm);
        }
    });
}

#[test]
fn local_names_skip_keys() {
    with_workspace(|w| {
        let value = Data::Object(&[("_0", Data::Null), ("a", Data::Null), ("_2", Data::Null)]);
        let s = value_module(w, &value, true);
        assert_eq!(declared_names(&s), ["_1", "_3", "_4", "_5"]);
        let expected = [("_1", "default"), ("_3", "_0"), ("_4", "a"), ("_5", "_2")];
        assert_eq!(export_pairs(&s), expected);
    });
}

#[test]
fn keys_are_read_from_the_default_export() {
    with_workspace(|w| {
        let value = Data::Object(&[
            ("a", Data::Null),
            ("default", Data::Null),
            ("b", Data::Null),
        ]);
        let s = value_module(w, &value, true);
        let hir = &s.hir;
        assert_eq!(hir.body.len(), 3);
        let expected = [("_0", "default"), ("_1", "a"), ("_2", "b")];
        assert_eq!(export_pairs(&s), expected);
        assert_eq!(declared_names(&s), ["_0", "_1", "_2"]);
        assert!(hir.var_decls.iter().all(|it| it.kind == VarKind::Const));
        for (declaration, key) in hir.var_decls[1..].iter().zip(["a", "b"]) {
            let Some((read_object, read_key)) = hir.member_key(declaration.init) else {
                panic!("initializer: {:?}", hir[declaration.init].kind);
            };
            assert_eq!(read_key, MemberKey::Name(w.atom(key)));
            let read_object = hir[read_object].kind;
            assert!(
                matches!(read_object, ExprKind::Ident(name) if name == w.atom("_0")),
                "object: {read_object:?}"
            );
        }
    });
}

#[test]
fn nested_properties_are_contiguous() {
    with_workspace(|w| {
        const INNER: Data<'static> = Data::Object(&[("c", Data::Null)]);
        let value = Data::Object(&[("a", INNER), ("b", Data::Array(&[INNER])), ("c", INNER)]);
        let data = DataModule::Value {
            default: w.data(&value),
            exports_keys: true,
        };
        let (s, root) = analyzed_root(w, &data);
        let ExprKind::Object(props) = s.hir[root].kind else {
            panic!("root: {:?}", s.hir[root].kind);
        };
        let props = &s.hir.props[props.range()];
        let keys: Vec<PropKey> = props.iter().map(|prop| prop.key).collect();
        assert_eq!(keys, ["a", "b", "c"].map(|key| PropKey::Name(w.atom(key))));
    });
}

#[test]
fn host_values_name_the_root() {
    with_workspace(|w| {
        for (value, exports_keys) in [
            (KEYED_OBJECT, false),
            (KEYED_OBJECT, true),
            (Data::String("s"), false),
            (Data::String("s"), true),
        ] {
            let default = w.data(&value);
            let data = DataModule::Value {
                default,
                exports_keys,
            };
            let tree = module(w, &data);
            let hir = &tree.file;
            let root = match hir[hir.id_at(hir.body, 0)].kind {
                StmtKind::ExportDefault(value) => value,
                StmtKind::Var(declarations) => hir[declarations.at(0)].init,
                kind => panic!("first statement: {kind:?}"),
            };
            let expected = [(root, HostValue::Data(default))];
            assert_eq!(tree.host_values, expected, "{data:?}");
            let is_object = matches!(hir[root].kind, ExprKind::Object(_));
            assert_eq!(is_object, matches!(value, Data::Object(_)), "{data:?}");
        }
    });
}

#[test]
fn native_addon_is_loaded_by_process_dlopen() {
    with_workspace(|w| {
        let path = w.atom("/x.node");
        let tree = module(w, &DataModule::NativeAddon { path });
        let hir = &tree.file;
        assert!(tree.host_values.is_empty());

        assert_eq!(hir.body.len(), 3);
        let StmtKind::Expr(load) = hir[hir.id_at(hir.body, 1)].kind else {
            panic!("second statement: {:?}", hir[hir.id_at(hir.body, 1)].kind);
        };
        let ExprKind::Call(call) = hir[load].kind else {
            panic!("second statement: {:?}", hir[load].kind);
        };
        let Some((process, name)) = hir.member_key(hir[call].callee) else {
            panic!("callee: {:?}", hir[hir[call].callee].kind);
        };
        assert!(matches!(hir[process].kind, ExprKind::Ident(name) if name == known::process));
        assert_eq!(name, MemberKey::Name(w.atom("dlopen")));
        let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
        let ExprKind::Ident(module) = hir[arguments[0]].kind else {
            panic!("first argument: {:?}", hir[arguments[0]].kind);
        };
        assert!(matches!(hir[arguments[1]].kind, ExprKind::String(text) if text == path));

        let StmtKind::ExportDefault(value) = hir[hir.id_at(hir.body, 2)].kind else {
            panic!("third statement: {:?}", hir[hir.id_at(hir.body, 2)].kind);
        };
        let Some((object, name)) = hir.member_key(value) else {
            panic!("default export: {:?}", hir[value].kind);
        };
        assert!(matches!(hir[object].kind, ExprKind::Ident(name) if name == module));
        assert_eq!(name, MemberKey::Name(known::exports));
    });
}

#[test]
fn runtime_require() {
    with_workspace(|w| {
        for loader_type in [Some("sqlite"), None] {
            for member in [Some("db"), None] {
                let tree = module(
                    w,
                    &DataModule::RuntimeRequire {
                        specifier: w.atom("./x.db"),
                        loader_type: loader_type.map(|name| w.atom(name)),
                        member: member.map(|name| w.atom(name)),
                    },
                );
                assert!(tree.host_values.is_empty());
                assert_runtime_require(&analyze(w, tree), loader_type, member);
            }
        }
    });
}

#[track_caller]
fn assert_runtime_require(s: &Analyzed<'_>, loader_type: Option<&str>, member: Option<&str>) {
    let w = &s.workspace;
    let [site] = s.analysis.import_sites else {
        panic!("sites: {:?}", s.analysis.import_sites);
    };
    let ImportSiteKind::ImportMetaRequire(call) = site.kind else {
        panic!("site: {:?}", site.kind);
    };
    assert!(site.is_host_value);
    assert!(matches!(s.hir[call].kind, ExprKind::Call(_)));
    assert_eq!(exprs_resolved_at_runtime(&s.hir), [call]);
    assert_eq!(site.specifier, ImportSpecifier::Constant(w.atom("./x.db")));
    match loader_type {
        Some(name) => {
            let found = s.hir.import_attribute(site.attributes, known::r#type);
            assert_eq!(found, Some(w.atom(name)));
        }
        None => assert_eq!(site.attributes, ExprId::NONE),
    }
    let value = export_default_value(&s.hir);
    match member {
        Some(member) => {
            let ExprKind::Dot { obj, name, .. } = s.hir[value].kind else {
                panic!("member: {:?}", s.hir[value].kind);
            };
            assert_eq!(name, w.atom(member));
            assert_eq!(obj, call);
        }
        None => assert_eq!(value, call),
    }
    assert_eq!(exports(s), ["default"]);
}

#[test]
fn database_names_the_modules_that_open_it() {
    with_workspace(|w| {
        for (is_embedded, modules) in [
            (false, &["bun:sqlite"][..]),
            (true, &["node:fs", "bun:sqlite"]),
        ] {
            let data = DataModule::Database {
                path: w.atom("/x.db"),
                is_embedded,
            };
            let s = analyzed_module(w, &data);
            let sites = s.analysis.import_sites.iter();
            let named: Vec<ImportSpecifier> = sites.map(|site| site.specifier).collect();
            let expected = modules
                .iter()
                .map(|name| ImportSpecifier::Constant(w.atom(name)));
            assert_eq!(named, expected.collect::<Vec<ImportSpecifier>>());
            assert!(
                s.analysis
                    .import_sites
                    .iter()
                    .all(|site| !site.is_host_value)
            );
            let value = export_default_value(&s.hir);
            assert!(matches!(s.hir[value].kind, ExprKind::New(_)));
            assert_eq!(exports(&s), ["default"]);
        }
    });
}

#[test]
fn runtime_require_is_host_value() {
    with_workspace(|w| {
        let data = DataModule::RuntimeRequire {
            specifier: w.atom("./x.node"),
            loader_type: None,
            member: None,
        };
        let tree = module(w, &data);
        assert!(tree.host_values.is_empty());
        let s = analyze(w, tree);
        let [site] = s.analysis.import_sites else {
            panic!("sites: {:?}", s.analysis.import_sites);
        };
        let ImportSiteKind::ImportMetaRequire(call) = site.kind else {
            panic!("site: {:?}", site.kind);
        };
        assert!(site.is_host_value);
        assert!(
            s.hir
                .expr_flags(call)
                .contains(ExprFlags::RESOLVED_AT_RUNTIME)
        );
        assert_eq!(s.analysis.decisions.decision(call), Decision::Unknown);
        assert!(!s.analysis.decisions.is_dead_expr(call));
    });
}

#[test]
fn root_is_decided_as_data() {
    with_workspace(|w| {
        let default = w.data(&JSON_TREES[0].0);
        for exports_keys in [false, true] {
            let data = DataModule::Value {
                default,
                exports_keys,
            };
            let (s, root) = analyzed_root(w, &data);
            let decisions = &s.analysis.decisions;
            assert_eq!(decisions.decision(root), Decision::Data(default));
            assert!(decisions.is_data_literal(root));
            assert!(!decisions.is_dead_expr(root));
            assert_eq!(decisions.constant(&s.hir, root), FoldedValue::Unknown);
            assert!(root.0 > 0);
            for below in (0..root.0).map(ExprId) {
                assert!(decisions.is_dead_expr(below), "{below:?}");
                assert_eq!(decisions.decision(below), Decision::Unknown, "{below:?}");
                if is_computed(&s.hir, below) {
                    let found = decisions.constant(&s.hir, below);
                    assert_eq!(found, FoldedValue::Unknown, "{below:?}");
                }
            }
            assert!((0..root.0).map(ExprId).any(|e| is_computed(&s.hir, e)));
            for read in index_reads(&s.hir) {
                assert!(!decisions.is_dead_expr(read), "{read:?}");
            }
            assert!(s.analysis.import_sites.is_empty());
            assert!(s.analysis.errors.is_empty());
        }
    });
}

#[test]
fn primitive_root_is_constant() {
    let cases = [
        (Data::String("s"), 0),
        (Data::Boolean(true), 0),
        (Data::Null, 0),
        (Data::Number(7.0), 0),
        (Data::BigInt("10"), 0),
        (Data::Number(-1.5), 1),
        (Data::Undefined, 1),
    ];
    with_workspace(|w| {
        for (value, operand_count) in cases {
            let default = w.data(&value);
            let data = DataModule::Value {
                default,
                exports_keys: false,
            };
            let (s, root) = analyzed_root(w, &data);
            let decisions = &s.analysis.decisions;
            let expected = Decision::of_data(default);
            assert!(matches!(expected, Decision::Constant(_)), "{value:?}");
            assert_eq!(decisions.decision(root), expected, "{value:?}");
            assert!(!decisions.is_data_literal(root), "{value:?}");
            assert_eq!(root.0, operand_count, "{value:?}");
            for operand in (0..root.0).map(ExprId) {
                assert!(decisions.is_dead_expr(operand), "{value:?}");
            }
        }
    });
}

#[test]
fn page_root_is_deferred() {
    with_workspace(|w| {
        let tree = module(w, &DataModule::Page);
        assert_eq!(tree.file.body.len(), 1);
        let root = export_default_value(&tree.file);
        assert_eq!(tree.host_values, [(root, HostValue::Deferred)]);
        let s = analyze(w, tree);
        let ExprKind::Unary {
            op: UnOp::Void,
            operand,
        } = s.hir[root].kind
        else {
            panic!("page: {:?}", s.hir[root].kind);
        };
        let decisions = &s.analysis.decisions;
        assert_eq!(decisions.decision(root), Decision::DeferredData);
        assert_eq!(decisions.constant(&s.hir, root), FoldedValue::Unknown);
        assert!(!decisions.is_data_literal(root));
        assert!(!decisions.is_dead_expr(root));
        assert!(decisions.is_dead_expr(operand));
        assert_eq!(exports(&s), ["default"]);
        assert_eq!(s.analysis.module_format, ModuleFormat::Esm);
        assert!(s.analysis.import_sites.is_empty());
    });
}

#[test]
fn roles() {
    with_workspace(|w| {
        let value = w.data(&KEYED_OBJECT);
        let value_with_require = w.data(&Data::Object(&[("require", Data::String("require"))]));
        let modules = [
            DataModule::Value {
                default: value,
                exports_keys: false,
            },
            DataModule::Value {
                default: value,
                exports_keys: true,
            },
            DataModule::Value {
                default: value_with_require,
                exports_keys: false,
            },
            DataModule::Value {
                default: value_with_require,
                exports_keys: true,
            },
            DataModule::RuntimeRequire {
                specifier: w.atom("./x"),
                loader_type: None,
                member: None,
            },
            DataModule::NativeAddon {
                path: w.atom("/x.node"),
            },
            DataModule::Page,
        ];
        for data in &modules {
            let hir = module(w, data).file;
            assert!(hir.is_js, "{data:?}");
            assert_eq!(hir.kind, FileKind::Tsx, "{data:?}");
            assert!(hir.has_module_syntax, "{data:?}");
            assert!(hir.is_strict && hir.is_strict_by_syntax, "{data:?}");
            let flagged = exprs_resolved_at_runtime(&hir);
            let is_require = matches!(data, DataModule::RuntimeRequire { .. });
            assert_eq!(flagged.len(), usize::from(is_require), "{data:?}");
        }
    });
}

#[test]
fn deep_values_do_not_overflow() {
    with_workspace(|w| {
        let mut value = DataValue::Array(&[]);
        for _ in 0..DEPTH {
            value = DataValue::Array(w.arena.alloc_slice_copy(&[value]));
        }
        let default: &DataValue<'_> = w.arena.alloc(value);
        for exports_keys in [false, true] {
            let data = DataModule::Value {
                default,
                exports_keys,
            };
            let tree = module(w, &data);
            let literal_count = tree.file.exprs.len() - usize::from(exports_keys);
            assert_eq!(literal_count, DEPTH + 1);
            let root = tree.host_values[0].0;
            let s = analyze(w, tree);
            if !s.bound.ran_out_of_stack {
                assert!(matches!(
                    s.analysis.decisions.decision(root),
                    Decision::Data(_)
                ));
            }
        }
    });
}
