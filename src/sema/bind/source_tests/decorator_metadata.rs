mod support;
use support::*;

use bun_sema::bind::decorator_metadata::{
    DesignKey, DesignValue, Metadata, MetadataCollector, MetadataGlobal, MetadataReference,
    entity_names, find_metadata_binding, is_legacy_decorated_member,
};

const IMPORTS: &str = r#"import { Foo, Bar } from "./m"; declare function d(...a: any[]): any; "#;
const DECORATOR: &str = "declare function d(...a: any[]): any; ";
const STRING_IMPORT: &str =
    r#"import { String } from "runtypes"; declare function d(...a: any[]): any; "#;

const ANNOTATIONS: &[(&str, &str, &[&str])] = &[
    ("Foo", "Foo", &["Foo"]),
    ("Foo<Bar>", "Foo", &["Foo"]),
    ("Foo | null", "Foo", &["Foo"]),
    ("null | Foo", "Foo", &["Foo"]),
    ("Foo | (Foo | undefined)", "Foo", &["Foo", "Foo"]),
    ("Foo | Bar", "Object", &["Foo", "Bar"]),
    ("Foo | string", "Object", &["Foo"]),
    ("Foo | unknown", "Object", &["Foo"]),
    ("any | Foo", "Object", &[]),
    ("Object | Foo", "Object", &["Object"]),
    ("Foo & unknown", "Foo", &["Foo"]),
    ("Foo & never", "Never", &["Foo"]),
    ("never & Foo", "Never", &[]),
    ("Foo[]", "Array", &["Foo"]),
    ("(Foo | Bar)[]", "Array", &["Foo", "Bar"]),
    ("readonly Foo[]", "Array", &[]),
    ("[Foo]", "Array", &[]),
    ("Foo[\"x\"]", "Object", &["Foo"]),
    ("keyof Foo", "Object", &[]),
    ("typeof d", "Object", &[]),
    ("{ a: Foo }", "Object", &[]),
    ("(a: Foo) => Bar", "Function", &[]),
    ("ns.A", "ns.A", &["ns.A"]),
    ("ns.A | ns.B", "ns.B", &["ns.A", "ns.B"]),
    ("ns.A | Foo", "Object", &["ns.A", "Foo"]),
    (
        "T extends Foo ? Bar : Bar",
        "Bar",
        &["T", "Foo", "Bar", "Bar"],
    ),
    ("T extends 1 ? Foo : Bar", "Object", &["T", "Foo", "Bar"]),
    ("T extends 1 ? any : Foo", "Object", &["T"]),
    ("T extends 1 ? never : Foo", "Never", &["T"]),
    ("import(\"./t\").T", "None", &[]),
    ("string | import(\"./t\").T", "String", &[]),
    ("Foo | import(\"./t\")", "Foo", &["Foo"]),
    ("Foo | import(\"./t\").T", "Object", &["Foo"]),
];

const READ_ANNOTATIONS: &[(&str, &[&str])] = &[
    ("class E { @d a: Foo; b: Bar; }", &["Foo"]),
    ("class E { @d declare a: Foo; }", &["Foo"]),
    ("class E { @d get a(): Foo { return 0 as any; } }", &["Foo"]),
    ("class E { @d set a(v: Foo) {} }", &["Foo"]),
    (
        "class E { @d m(a: Foo): Bar { return a as any; } }",
        &["Foo", "Bar"],
    ),
    ("class E { @d m(...r: Foo[]) {} }", &[]),
    ("class E { m(a: Foo): Bar { return a as any; } }", &[]),
    ("class E { m(a: Foo, @d b: Bar) {} }", &["Bar"]),
    (
        "class E { m(@d a: Foo, b: Bar): Foo { return a; } }",
        &["Foo", "Bar"],
    ),
    ("class E { constructor(a: Foo, @d b: Bar) {} }", &["Bar"]),
    (
        "@d class E { constructor(a: Foo, b: Bar) {} }",
        &["Foo", "Bar"],
    ),
    (
        "@d class E { constructor(a: Foo); constructor(a: any) {} }",
        &["Foo"],
    ),
    ("const E = class { @d a: Foo; };", &["Foo"]),
];

const DECORATED_MEMBERS: &[(&str, bool)] = &[
    ("@d a: Foo;", true),
    ("@d declare a: Foo;", true),
    ("@d m() {}", true),
    ("m(@d a: Foo) {}", true),
    ("constructor(@d a: Foo) {}", true),
    ("a: Foo;", false),
    ("m(a: Foo) {}", false),
    ("@d #a: Foo;", false),
    ("@d m(): void;", false),
    ("static {}", false),
];

fn analyzed_with_option(
    text: &str,
    emits_decorator_metadata: bool,
    test: impl for<'s> FnOnce(&Analyzed<'s>) + Send,
) {
    let runtime = RuntimeBindOptions {
        emits_decorator_metadata,
        ..Default::default()
    };
    let source = Source {
        experimental_decorators: true,
        runtime,
        ..Source::new("a.ts", text)
    };
    with_workspace(|workspace| {
        test(&workspace.analyze(&source));
    });
}

fn analyzed_metadata(text: &str, test: impl for<'s> FnOnce(&Analyzed<'s>) + Send) {
    analyzed_with_option(text, true, test);
}

fn import_spec(s: &Analyzed<'_>, index: u32) -> SymbolId {
    s.bound
        .declared_symbol(Decl::ImportSpec(ImportSpecId(index)))
}

fn is_unused(s: &Analyzed<'_>, symbol: SymbolId) -> bool {
    s.analysis.unused_import_symbols.contains(&symbol)
}

fn dotted_name(s: &Analyzed<'_>, node: TypeNodeId) -> String {
    let names = s.hir.texts(entity_names(&s.hir, node));
    let names: Vec<&str> = names.map(|name| s.workspace.text(name)).collect();
    names.join(".")
}

fn describe(s: &Analyzed<'_>, metadata: Metadata) -> String {
    match metadata {
        Metadata::Name(node) | Metadata::QualifiedName(node) => dotted_name(s, node),
        other => format!("{other:?}"),
    }
}

fn first_member(s: &Analyzed<'_>, class: &str) -> MemberId {
    s.hir[s.class(class)].members.at(0)
}

fn recorded_type_names(s: &Analyzed<'_>) -> Vec<String> {
    let references = s.bound.runtime.implicit_references().iter();
    let names = references.filter_map(|reference| match reference.kind {
        ImplicitReferenceKind::DecoratorMetadata(MetadataReference::TypeName(node)) => {
            Some(dotted_name(s, node))
        }
        _ => None,
    });
    names.collect()
}

fn global_binding(s: &Analyzed<'_>, class: &str, global: MetadataGlobal) -> Option<Binding> {
    let reference = MetadataReference::Global(s.class(class), global);
    find_metadata_binding(s.bound.runtime.implicit_references(), reference)
}

#[test]
fn annotation_metadata_matches_js_parser() {
    for &(annotation, expected, expected_visits) in ANNOTATIONS {
        let text = format!("{IMPORTS}class C<T> {{ @d a: {annotation}; }}");
        analyzed_metadata(&text, |s| {
            let mut collector = MetadataCollector::new(&s.hir);
            let entries = collector.collect_member(first_member(s, "C"));
            let [(DesignKey::Type, DesignValue::Type(metadata))] = entries[..] else {
                panic!("{annotation}: {entries:?}");
            };
            assert_eq!(describe(s, metadata), expected, "{annotation}");
            let visits = collector.visited().iter();
            let visits: Vec<String> = visits.map(|visit| dotted_name(s, visit.node)).collect();
            assert_eq!(visits, expected_visits, "{annotation}");
        });
    }
}

#[test]
fn binder_records_every_visited_name() {
    for &(annotation, _, expected_visits) in ANNOTATIONS {
        let text = format!("{IMPORTS}class C<T> {{ @d a: {annotation}; }}");
        analyzed_metadata(&text, |s| {
            let mut expected: Vec<&str> = expected_visits.to_vec();
            let mut recorded = recorded_type_names(s);
            expected.sort_unstable();
            recorded.sort_unstable();
            assert_eq!(recorded, expected, "{annotation}");
        });
    }
}

#[test]
fn recorded_names_are_sorted_by_type_node() {
    let class = "class C { @d a: Foo | Bar; @d m(x: Bar[]): Foo { return 0 as any; } }";
    let text = format!("{IMPORTS}{class}");
    analyzed_metadata(&text, |s| {
        let references = s.bound.runtime.implicit_references();
        assert_eq!(references.len(), 4);
        for reference in references {
            let ImplicitReferenceKind::DecoratorMetadata(recorded) = reference.kind else {
                panic!("{reference:?}");
            };
            assert_eq!(
                find_metadata_binding(references, recorded),
                Some(reference.binding)
            );
        }
    });
}

#[test]
fn annotations_are_read_per_member() {
    for &(class, expected) in READ_ANNOTATIONS {
        analyzed_metadata(&format!("{IMPORTS}{class}"), |s| {
            assert_eq!(recorded_type_names(s), expected, "{class}");
        });
    }
}

#[test]
fn members_serialize_in_js_parser_order() {
    let members = [
        "@d m(a: string): void {}",
        "@d get g(): number { return 1; }",
        "@d set s(v: boolean) {}",
        "@d async p() {}",
        "@d declare w: string;",
    ];
    let text = format!("{DECORATOR}class C {{ {} }}", members.join(" "));
    analyzed_metadata(&text, |s| {
        let members = s.hir[s.class("C")].members;
        let mut collector = MetadataCollector::new(&s.hir);
        let mut entries_of = |index| format!("{:?}", collector.collect_member(members.at(index)));
        assert_eq!(
            entries_of(0),
            "[(Type, Type(Function)), (ParameterTypes, Types([String])), (ReturnType, Type(Void))]"
        );
        assert_eq!(
            entries_of(1),
            "[(Type, Type(Number)), (ParameterTypes, Types([]))]"
        );
        assert_eq!(
            entries_of(2),
            "[(ParameterTypes, Types([Boolean])), (Type, Type(Boolean))]"
        );
        assert_eq!(
            entries_of(3),
            "[(Type, Type(Function)), (ParameterTypes, Types([])), (ReturnType, Type(Promise))]"
        );
        assert_eq!(entries_of(4), "[]");
    });
}

#[test]
fn visited_names_keep_imports() {
    let assert_unused_imports = |class: &str, expected: [bool; 2]| {
        analyzed_metadata(&format!("{IMPORTS}{class}"), |s| {
            let unused = [0, 1].map(|index| is_unused(s, import_spec(s, index)));
            assert_eq!(unused, expected, "{class}");
        });
    };
    assert_unused_imports("class C { @d a: Foo | string; }", [false, true]);
    assert_unused_imports("class C { @d a: Foo[]; }", [false, true]);
    assert_unused_imports("class C { @d a: any | Foo; }", [true, true]);
    assert_unused_imports("class C { m(a: Foo, @d b: Bar) {} }", [true, false]);
    let overloads = "@d class C { constructor(a: Foo); constructor(a: any) {} }";
    assert_unused_imports(overloads, [false, true]);
}

#[test]
fn names_resolve_from_class_scope() {
    analyzed_metadata(
        &format!("{IMPORTS}class B {{ @d m(Foo: Foo) {{}} }}"),
        |s| {
            let references = s.bound.runtime.implicit_references();
            let bindings: Vec<Binding> = references.iter().map(|r| r.binding).collect();
            assert_eq!(bindings, [Binding::Symbol(import_spec(s, 0))]);
        },
    );
}

#[test]
fn references_name_annotated_node() {
    let members = "constructor(@d p: Foo) {} @d m(x: Foo): Bar { return x as any; } @d a: Foo;";
    let text = format!("{IMPORTS}class D {{ {members} }}");
    analyzed_metadata(&text, |s| {
        let references = s.bound.runtime.implicit_references().iter();
        let nodes: Vec<&str> = references
            .map(|reference| match reference.node {
                NodeData::Param(_) => "parameter",
                NodeData::Member(_) => "member",
                _ => "other",
            })
            .collect();
        assert_eq!(nodes, ["parameter", "parameter", "member", "member"]);
    });

    let overloads = "@d class E { constructor(p: Foo); constructor(p: Foo) {} }";
    analyzed_metadata(&format!("{IMPORTS}{overloads}"), |s| {
        let references = s.bound.runtime.implicit_references().iter();
        let has_body_by_reference: Vec<bool> = references
            .map(|reference| {
                let NodeData::Param(parameter) = reference.node else {
                    panic!("{reference:?}");
                };
                has_body(&s.hir[s.bound.param_fn[parameter.idx()]])
            })
            .collect();
        assert_eq!(has_body_by_reference, [false, true]);
    });

    let text = format!("{STRING_IMPORT}class A {{ @d x: string; }}");
    analyzed_metadata(&text, |s| {
        let [reference] = s.bound.runtime.implicit_references() else {
            panic!("{:?}", s.bound.runtime.implicit_references());
        };
        assert_eq!(reference.node, NodeData::Member(first_member(s, "A")));
    });
}

#[test]
fn bound_globals_are_recorded() {
    let text = format!("{STRING_IMPORT}class A {{ @d x: string; }}");
    analyzed_metadata(&text, |s| {
        let string = import_spec(s, 0);
        let recorded = global_binding(s, "A", MetadataGlobal::String);
        assert_eq!(recorded, Some(Binding::Symbol(string)));
        assert_eq!(s.bound.runtime.implicit_references().len(), 1);
        assert!(!is_unused(s, string));
    });

    let import = "import Promise from \"bluebird\"; ";
    let text = format!("{import}{DECORATOR}class A {{ @d async m() {{}} }}");
    analyzed_metadata(&text, |s| {
        let promise = s.bound.declared_symbol(Decl::ImportDefault(ImportId(0)));
        let recorded = global_binding(s, "A", MetadataGlobal::Promise);
        assert_eq!(recorded, Some(Binding::Symbol(promise)));
        assert_eq!(global_binding(s, "A", MetadataGlobal::Function), None);
        assert!(!is_unused(s, promise));
    });

    let import = "import { Object } from \"./o\"; ";
    let text = format!("{import}{DECORATOR}class A {{ @d x: Missing; @d y: bigint; }}");
    analyzed_metadata(&text, |s| {
        let recorded = global_binding(s, "A", MetadataGlobal::Object);
        assert_eq!(recorded, Some(Binding::Symbol(import_spec(s, 0))));
        assert_eq!(global_binding(s, "A", MetadataGlobal::BigInt), None);
    });
}

#[test]
fn globals_resolve_from_enclosing_scope() {
    let function = "function f() { const Number = 1; class A { @d x: number; } }";
    let text = format!("{DECORATOR}{function}");
    analyzed_metadata(&text, |s| {
        let recorded = global_binding(s, "A", MetadataGlobal::Number);
        assert_eq!(recorded, Some(Binding::Symbol(s.variable("Number", 0))));
    });

    analyzed_metadata(
        &format!("{DECORATOR}class String {{ @d x: string; }}"),
        |s| {
            let class_symbol = s.bound.class_symbol[s.class("String").idx()];
            let recorded = global_binding(s, "String", MetadataGlobal::String);
            assert_eq!(recorded, Some(Binding::Symbol(class_symbol)));
        },
    );
}

#[test]
fn unserialized_globals_are_not_recorded() {
    let classes = [
        "class A { x: string; }",
        "class A { @d x: number; }",
        "class A { @d declare x: string; }",
        "class A { @d m(x: string): void; m(x: any) {} }",
        "const A = class { @d x: string; };",
    ];
    for class in classes {
        let text = format!("{STRING_IMPORT}{class}");
        analyzed_metadata(&text, |s| {
            assert_eq!(s.bound.runtime.implicit_references(), [], "{class}");
            assert!(is_unused(s, import_spec(s, 0)), "{class}");
        });
    }
}

#[test]
fn nothing_is_recorded_without_option() {
    let import = "import { Foo } from \"./m\"; ";
    let text = format!("{import}{STRING_IMPORT}class A {{ @d x: string; @d y: Foo; }}");
    analyzed_with_option(&text, false, |s| {
        assert_eq!(s.bound.runtime.implicit_references(), []);
    });
}

#[test]
fn legacy_decorated_members() {
    for &(member, expected) in DECORATED_MEMBERS {
        analyzed_metadata(&format!("{IMPORTS}class C {{ {member} }}"), |s| {
            let actual = is_legacy_decorated_member(&s.hir, first_member(s, "C"));
            assert_eq!(actual, expected, "{member}");
        });
    }
}
