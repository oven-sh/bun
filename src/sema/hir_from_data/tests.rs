use super::*;
use crate::atom::{Atom, Interner, known};
use crate::hir::{
    ExprFlags, ExprId, ExprKind, File, FileKind, MemberKey, NameKind, PatKind, PropKey, StmtKind,
    UnOp, VarKind, is_proto_setter,
};
use crate::session::{Arena, Session};

fn with_atoms(run: impl for<'s> FnOnce(&Interner<'s>, &'s Arena)) {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    run(&atoms, session.arena());
}

fn intern_all<const N: usize>(atoms: &Interner<'_>, texts: [&str; N]) -> [Atom; N] {
    texts.map(|text| atoms.intern(text.as_bytes()))
}

fn default_export_module<'s>(
    default: &'s DataValue<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> DataModuleTree<'s> {
    let module = DataModule::Value {
        default,
        exports_keys: false,
    };
    module_from_data(&module, atoms, arena)
}

fn key_export_module<'s>(
    default: &'s DataValue<'s>,
    atoms: &Interner<'s>,
    arena: &'s Arena,
) -> DataModuleTree<'s> {
    let module = DataModule::Value {
        default,
        exports_keys: true,
    };
    module_from_data(&module, atoms, arena)
}

fn default_value(hir: &File<'_>) -> ExprId {
    let first = hir.id_at(hir.body, 0);
    match hir[first].kind {
        StmtKind::ExportDefault(value) => value,
        StmtKind::Var(declarations) => hir[declarations.at(0)].init,
        kind => panic!("first statement: {kind:?}"),
    }
}

fn exports(hir: &File<'_>) -> Vec<(Atom, Atom)> {
    let specs = hir.export_specs.iter();
    specs.map(|spec| (spec.local, spec.exported)).collect()
}

fn declared_names(hir: &File<'_>) -> Vec<Atom> {
    let declarations = hir.var_decls.iter();
    let names = declarations.map(|declaration| match hir[declaration.pat].kind {
        PatKind::Ident(name) => name,
        kind => panic!("declared pattern: {kind:?}"),
    });
    names.collect()
}

fn number_bits(hir: &File<'_>, e: ExprId) -> Option<u64> {
    match hir[e].kind {
        ExprKind::Number(index) => Some(hir.numbers[index as usize].to_bits()),
        _ => None,
    }
}

fn exprs_resolved_at_runtime(hir: &File<'_>) -> impl Iterator<Item = ExprId> {
    let ids = (0..hir.exprs.len() as u32).map(ExprId);
    ids.filter(move |&e| hir.expr_flags(e).contains(ExprFlags::RESOLVED_AT_RUNTIME))
}

#[test]
fn file_is_strict_javascript_module() {
    with_atoms(|atoms, arena| {
        let hir = default_export_module(&DataValue::Null, atoms, arena).file;
        assert_eq!(hir.kind, FileKind::Tsx);
        assert!(hir.is_js && hir.has_module_syntax);
        assert!(hir.is_strict && hir.is_strict_by_syntax);
        assert!(hir.text.is_empty());
        assert_eq!(hir.source_len, 0);
    });
}

#[test]
fn local_names_skip_keys() {
    with_atoms(|atoms, arena| {
        let keys = intern_all(atoms, ["_0", "a", "_2"]);
        let properties = keys.map(|key| (key, DataValue::Null));
        let object = DataValue::Object(&properties);
        let hir = key_export_module(&object, atoms, arena).file;
        let names = intern_all(atoms, ["_1", "_3", "_4", "_5"]);
        assert_eq!(declared_names(&hir), names);
        let exported = [known::default, keys[0], keys[1], keys[2]];
        let expected: Vec<(Atom, Atom)> = names.into_iter().zip(exported).collect();
        assert_eq!(exports(&hir), expected);
    });
}

#[test]
fn object_keys_are_read_from_default_export() {
    with_atoms(|atoms, arena| {
        let [a, b, object_name, a_name, b_name] = intern_all(atoms, ["a", "b", "_0", "_1", "_2"]);
        let properties = [
            (a, DataValue::Null),
            (known::default, DataValue::Null),
            (b, DataValue::Null),
        ];
        let object = DataValue::Object(&properties);
        let hir = key_export_module(&object, atoms, arena).file;
        assert_eq!(hir.body.len(), 3);
        let expected = [(object_name, known::default), (a_name, a), (b_name, b)];
        assert_eq!(exports(&hir), expected);
        assert_eq!(declared_names(&hir), [object_name, a_name, b_name]);
        assert!(hir.var_decls.iter().all(|it| it.kind == VarKind::Const));
        for (declaration, key) in hir.var_decls[1..].iter().zip([a, b]) {
            let Some((read_object, read_key)) = hir.member_key(declaration.init) else {
                panic!("initializer: {:?}", hir[declaration.init].kind);
            };
            assert_eq!(read_key, MemberKey::Name(key));
            let read_object = hir[read_object].kind;
            assert!(
                matches!(read_object, ExprKind::Ident(name) if name == object_name),
                "object: {read_object:?}"
            );
        }
    });
}

#[test]
fn object_without_exported_keys() {
    with_atoms(|atoms, arena| {
        let only_default = [(known::default, DataValue::Null)];
        let no_properties: &[(Atom, DataValue<'_>)] = &[];
        for properties in [&only_default[..], no_properties] {
            let object = DataValue::Object(properties);
            let hir = key_export_module(&object, atoms, arena).file;
            assert_eq!(hir.body.len(), 2);
            assert_eq!(hir.var_decls.len(), 1);
            let exported: Vec<Atom> = exports(&hir).into_iter().map(|it| it.1).collect();
            assert_eq!(exported, [known::default]);
        }
    });
}

#[test]
fn other_value_exports_default_and_marker() {
    with_atoms(|atoms, arena| {
        let [default_name, marker_name] = intern_all(atoms, ["_0", "_1"]);
        let elements = [DataValue::Null];
        for value in [DataValue::Array(&elements), DataValue::String(known::value)] {
            let hir = key_export_module(&value, atoms, arena).file;
            assert_eq!(hir.body.len(), 2);
            let expected = [
                (default_name, known::default),
                (marker_name, known::__esModule),
            ];
            assert_eq!(exports(&hir), expected, "{value:?}");
            assert_eq!(declared_names(&hir), [default_name, marker_name]);
            let marker = hir[hir.var_decls[1].init].kind;
            assert!(matches!(marker, ExprKind::True), "marker: {marker:?}");
        }
    });
}

#[test]
fn nested_properties_are_contiguous() {
    with_atoms(|atoms, arena| {
        let [a, b, c] = intern_all(atoms, ["a", "b", "c"]);
        let inner = [(c, DataValue::Null)];
        let elements = [DataValue::Object(&inner)];
        let outer = [
            (a, DataValue::Object(&inner)),
            (b, DataValue::Array(&elements)),
            (c, DataValue::Object(&inner)),
        ];
        let value = DataValue::Object(&outer);
        let tree = key_export_module(&value, atoms, arena);
        let hir = &tree.file;
        let root = tree.host_values[0].0;
        let ExprKind::Object(props) = hir[root].kind else {
            panic!("root: {:?}", hir[root].kind);
        };
        let props = &hir.props[props.range()];
        let keys: Vec<PropKey> = props.iter().map(|prop| prop.key).collect();
        assert_eq!(keys, [a, b, c].map(PropKey::Name));
    });
}

#[test]
fn host_values_name_the_root() {
    with_atoms(|atoms, arena| {
        let properties = [(known::value, DataValue::Null)];
        let object = DataValue::Object(&properties);
        let text = DataValue::String(known::value);
        let cases = [
            (&object, false),
            (&object, true),
            (&text, false),
            (&text, true),
        ];
        for (default, exports_keys) in cases {
            let module = DataModule::Value {
                default,
                exports_keys,
            };
            let tree = module_from_data(&module, atoms, arena);
            let root = default_value(&tree.file);
            let expected = [(root, HostValue::Data(default))];
            assert_eq!(tree.host_values, expected, "{module:?}");
            let is_object = matches!(tree.file[root].kind, ExprKind::Object(_));
            assert_eq!(is_object, std::ptr::eq(default, &object), "{module:?}");
        }
    });
}

#[test]
fn page_is_deferred() {
    with_atoms(|atoms, arena| {
        let tree = module_from_data(&DataModule::Page, atoms, arena);
        let hir = &tree.file;
        assert_eq!(hir.body.len(), 1);
        let manifest = default_value(hir);
        let kind = hir[manifest].kind;
        assert!(
            matches!(kind, ExprKind::Unary { op: UnOp::Void, .. }),
            "manifest: {kind:?}"
        );
        assert_eq!(tree.host_values, [(manifest, HostValue::Deferred)]);
    });
}

#[test]
fn runtime_require_call_is_resolved_at_runtime() {
    with_atoms(|atoms, arena| {
        let [specifier, sqlite, db] = intern_all(atoms, ["/x.db", "sqlite", "db"]);
        for (loader_type, member) in [(Some(sqlite), Some(db)), (None, None)] {
            let module = DataModule::RuntimeRequire {
                specifier,
                loader_type,
                member,
            };
            let tree = module_from_data(&module, atoms, arena);
            let hir = &tree.file;
            assert!(tree.host_values.is_empty());
            let flagged: Vec<ExprId> = exprs_resolved_at_runtime(hir).collect();
            let [request] = flagged[..] else {
                panic!("flagged: {flagged:?}");
            };
            let ExprKind::Call(call) = hir[request].kind else {
                panic!("flagged: {:?}", hir[request].kind);
            };
            let value = default_value(hir);
            match member {
                Some(member) => {
                    let expected = Some((request, MemberKey::Name(member)));
                    assert_eq!(hir.member_key(value), expected);
                }
                None => assert_eq!(value, request),
            }
            let arguments: Vec<ExprId> = hir.ids(hir[call].args).collect();
            let first_argument = hir[arguments[0]].kind;
            assert!(
                matches!(first_argument, ExprKind::String(text) if text == specifier),
                "first argument: {first_argument:?}"
            );
            let options = arguments.get(1).copied().unwrap_or(ExprId::NONE);
            assert_eq!(hir.import_attribute(options, known::r#type), loader_type);
        }
    });
}

#[test]
fn native_addon_is_loaded_by_process_dlopen() {
    with_atoms(|atoms, arena| {
        let [path, dlopen] = intern_all(atoms, ["/x.node", "dlopen"]);
        let tree = module_from_data(&DataModule::NativeAddon { path }, atoms, arena);
        let hir = &tree.file;
        assert!(tree.host_values.is_empty());
        assert_eq!(exprs_resolved_at_runtime(hir).count(), 0);

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
        assert_eq!(name, MemberKey::Name(dlopen));
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
fn runtime_require_calls_import_meta_require() {
    with_atoms(|atoms, arena| {
        let module = DataModule::RuntimeRequire {
            specifier: known::module,
            loader_type: None,
            member: None,
        };
        let hir = module_from_data(&module, atoms, arena).file;
        let ExprKind::Call(call) = hir[default_value(&hir)].kind else {
            panic!("default export: {:?}", hir[default_value(&hir)].kind);
        };
        let Some((object, name)) = hir.member_key(hir[call].callee) else {
            panic!("callee: {:?}", hir[hir[call].callee].kind);
        };
        assert_eq!(name, MemberKey::Name(known::require));
        let object = hir[object].kind;
        assert!(matches!(object, ExprKind::ImportMeta), "object: {object:?}");
    });
}

#[test]
fn values_have_no_call_resolved_at_runtime() {
    with_atoms(|atoms, arena| {
        let properties = [(known::require, DataValue::String(known::require))];
        let value = DataValue::Object(&properties);
        let modules = [
            DataModule::Value {
                default: &value,
                exports_keys: false,
            },
            DataModule::Value {
                default: &value,
                exports_keys: true,
            },
            DataModule::Page,
        ];
        for module in &modules {
            let hir = module_from_data(module, atoms, arena).file;
            assert_eq!(exprs_resolved_at_runtime(&hir).count(), 0, "{module:?}");
        }
    });
}

#[test]
fn undefined_is_void_zero() {
    with_atoms(|atoms, arena| {
        let hir = default_export_module(&DataValue::Undefined, atoms, arena).file;
        let kind = hir[default_value(&hir)].kind;
        let ExprKind::Unary {
            op: UnOp::Void,
            operand,
        } = kind
        else {
            panic!("undefined: {kind:?}");
        };
        assert_eq!(number_bits(&hir, operand), Some(0.0f64.to_bits()));
    });
}

#[test]
fn negative_number_is_negated_literal() {
    with_atoms(|atoms, arena| {
        let cases = [
            (-1.5f64, 1.5f64),
            (-0.0, 0.0),
            (f64::NEG_INFINITY, f64::INFINITY),
        ];
        for (number, magnitude) in cases {
            let value = DataValue::Number(number);
            let hir = default_export_module(&value, atoms, arena).file;
            let kind = hir[default_value(&hir)].kind;
            let ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } = kind
            else {
                panic!("{number}: {kind:?}");
            };
            assert_eq!(
                number_bits(&hir, operand),
                Some(magnitude.to_bits()),
                "{number}"
            );
        }
    });
}

#[test]
fn other_number_is_literal() {
    with_atoms(|atoms, arena| {
        for number in [0.0f64, 1.5, f64::INFINITY, f64::NAN, -f64::NAN] {
            let value = DataValue::Number(number);
            let hir = default_export_module(&value, atoms, arena).file;
            let root = default_value(&hir);
            assert_eq!(number_bits(&hir, root), Some(number.to_bits()), "{number}");
        }
    });
}

#[test]
fn proto_key_defines_own_property() {
    with_atoms(|atoms, arena| {
        let properties = [
            (known::__proto__, DataValue::Null),
            (known::value, DataValue::Null),
        ];
        let object = DataValue::Object(&properties);
        let hir = default_export_module(&object, atoms, arena).file;
        let name_kinds: Vec<NameKind> = hir.props.iter().map(|prop| prop.name_kind).collect();
        assert_eq!(
            name_kinds,
            [NameKind::ComputedString, NameKind::StringLiteral]
        );
        assert!(!hir.props.iter().any(is_proto_setter));
    });
}
