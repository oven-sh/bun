#![cfg(not(miri))]

mod declarations;

use self::declarations::{Annotation, Declaration, DeclarationsHost, Signature, SourceFile};
use super::*;
use crate::check::aot::builtin_types::{BuiltinClassIndex, BuiltinTypeSymbols};
use crate::resolve::Options;
use crate::session::Session;

const LIBRARY_PATH: &str = "/lib.d.ts";
const MAP: u32 = 0;
const SET: u32 = 1;
const ERROR: u32 = 2;
const TYPE_ERROR: u32 = 3;
const DATE_TIME_FORMAT: u32 = 4;
const WEAK_REF: u32 = 5;
const DATABASE: u32 = 6;
const READONLY_MAP_TYPE_NAME: u32 = 1;

const LIBRARY: SourceFile = script(
    LIBRARY_PATH,
    &[
        interface("Map"),
        interface("ReadonlyMap"),
        interface("Set"),
        interface("Error"),
        subinterface("TypeError", &["Error"]),
        interface("PropertyDescriptor"),
        Declaration::Namespace {
            name: "Intl",
            body: &[interface("DateTimeFormat")],
        },
    ],
);

const TYPE_PATHS: [BuiltinTypePath<'static>; 7] = [
    type_path(MAP, &["Map"], Denotation::Exact),
    BuiltinTypePath {
        type_name: READONLY_MAP_TYPE_NAME,
        ..type_path(MAP, &["ReadonlyMap"], Denotation::View)
    },
    type_path(SET, &["Set"], Denotation::Exact),
    type_path(ERROR, &["Error"], Denotation::Exact),
    type_path(TYPE_ERROR, &["TypeError"], Denotation::Exact),
    type_path(
        DATE_TIME_FORMAT,
        &["Intl", "DateTimeFormat"],
        Denotation::Exact,
    ),
    type_path(WEAK_REF, &["WeakRef"], Denotation::Exact),
];

const SQL_MODULE: &[Declaration] = &[Declaration::AmbientModule {
    specifier: "bun",
    body: &[
        callable("Other", &[], &[Signature::Call]),
        callable(
            "SQL",
            &[],
            &[Signature::Call, Signature::Call, Signature::Method("close")],
        ),
        class("SQL"),
        callable("TransactionSQL", &["SQL"], &[Signature::Call]),
        variable("sql", "SQL"),
        variable("postgres", "SQL"),
        variable("other", "Other"),
    ],
}];

const fn script(path: &'static str, declarations: &'static [Declaration]) -> SourceFile {
    SourceFile {
        path,
        is_module: false,
        declarations,
    }
}

const fn module(path: &'static str, declarations: &'static [Declaration]) -> SourceFile {
    SourceFile {
        path,
        is_module: true,
        declarations,
    }
}

const fn callable(
    name: &'static str,
    extends: &'static [&'static str],
    members: &'static [Signature],
) -> Declaration {
    Declaration::Interface {
        name,
        extends,
        members,
    }
}

const fn subinterface(name: &'static str, extends: &'static [&'static str]) -> Declaration {
    callable(name, extends, &[])
}

const fn interface(name: &'static str) -> Declaration {
    subinterface(name, &[])
}

const fn class(name: &'static str) -> Declaration {
    Declaration::Class {
        name,
        extends: None,
        implements: &[],
    }
}

const fn variable(name: &'static str, type_name: &'static str) -> Declaration {
    Declaration::Variable {
        name,
        annotation: Annotation::Reference(type_name),
    }
}

const fn function(name: &'static str, has_body: bool) -> Declaration {
    Declaration::Function { name, has_body }
}

const fn type_path<'a>(
    class: u32,
    names: &'a [&'a str],
    denotation: Denotation,
) -> BuiltinTypePath<'a> {
    BuiltinTypePath {
        class: BuiltinClassIndex(class),
        type_name: 0,
        module: None,
        names,
        denotation,
    }
}

const fn value_path<'a>(
    value: u32,
    module: Option<&'a str>,
    names: &'a [&'a str],
) -> BuiltinValuePath<'a> {
    BuiltinValuePath {
        value: BuiltinValueIndex(value),
        module,
        names,
    }
}

const fn exact(class: u32) -> Option<BuiltinTypeClass> {
    Some(BuiltinTypeClass {
        class: BuiltinClassIndex(class),
        type_name: 0,
        denotation: Denotation::Exact,
    })
}

const fn view(class: u32) -> Option<BuiltinTypeClass> {
    Some(BuiltinTypeClass {
        class: BuiltinClassIndex(class),
        type_name: 0,
        denotation: Denotation::View,
    })
}

fn with_files<R>(sources: &[SourceFile], test: impl FnOnce(&Files<'_>) -> R) -> R {
    let host = DeclarationsHost { files: sources };
    let session = Session::new();
    let roots: Vec<Vec<u8>> = (sources.iter())
        .map(|source| source.path.as_bytes().to_vec())
        .collect();
    test(&Files::load(
        &session,
        None,
        &host,
        Options::default(),
        &roots,
        &|_| {},
    ))
}

fn file_at(files: &Files<'_>, path: &str) -> FileId {
    let file = files.by_path.get(path.as_bytes());
    file.unwrap_or_else(|| panic!("{path} is not in the program"))
}

fn atom_of(files: &Files<'_>, name: &str) -> Atom {
    let atom = files.atoms.lookup(name.as_bytes());
    atom.unwrap_or_else(|| panic!("no file mentions {name}"))
}

fn interface_symbol(files: &Files<'_>, path: &str, name: &str) -> Sym {
    let (file, name) = (file_at(files, path), atom_of(files, name));
    let mut interfaces = files.hir(file).interfaces.iter();
    let index = interfaces.position(|interface| interface.name == name);
    let index = index.unwrap_or_else(|| panic!("{path} declares no such interface"));
    files.sym(file, files.bound(file).interface_symbol[index])
}

fn class_symbol(files: &Files<'_>, path: &str, name: &str) -> Sym {
    let (file, name) = (file_at(files, path), atom_of(files, name));
    let mut classes = files.hir(file).classes.iter();
    let index = classes.position(|class| class.name == name);
    let index = index.unwrap_or_else(|| panic!("{path} declares no such class"));
    files.sym(file, files.bound(file).class_symbol[index])
}

fn classes_of_library_types(
    sources: &[SourceFile],
    names: &[&str],
) -> Vec<Option<BuiltinTypeClass>> {
    with_files(sources, |files| {
        let classes = resolve_type_classes(files, &TYPE_PATHS);
        let class_of = |name: &&str| {
            let symbol = interface_symbol(files, LIBRARY_PATH, name);
            classes.get(&symbol).copied()
        };
        names.iter().map(class_of).collect()
    })
}

fn values_of_functions(
    sources: &[SourceFile],
    path: &str,
    values: &[BuiltinValuePath<'_>],
) -> Vec<Option<u32>> {
    with_files(sources, |files| {
        let signatures = collect_call_signatures(files, values);
        let file = file_at(files, path);
        let functions = (0..files.hir(file).fns.len() as u32).map(FnId);
        let values = functions.map(|function| signatures.get(&FunctionRef { file, function }));
        values.map(|value| value.map(|value| value.0)).collect()
    })
}

fn values_of_call_signatures(
    declarations: &'static [Declaration],
    values: &[BuiltinValuePath<'_>],
) -> Vec<Option<u32>> {
    with_files(&[script("/bun.d.ts", declarations)], |files| {
        let signatures = collect_call_signatures(files, values);
        let file = file_at(files, "/bun.d.ts");
        let members = files.hir(file).members.iter();
        members
            .filter(|member| member.kind == MemberKind::CallSignature)
            .map(|member| FunctionRef {
                file,
                function: member.func,
            })
            .map(|signature| signatures.get(&signature).map(|value| value.0))
            .collect()
    })
}

#[test]
fn library_type_has_class() {
    let classes = classes_of_library_types(&[LIBRARY], &["Map", "Set", "Error"]);
    assert_eq!(classes, [exact(MAP), exact(SET), exact(ERROR)]);
}

#[test]
fn library_type_outside_table_has_no_class() {
    let classes = classes_of_library_types(&[LIBRARY], &["PropertyDescriptor"]);
    assert_eq!(classes, [None]);
}

#[test]
fn path_without_declaration_has_no_entry() {
    with_files(&[LIBRARY], |files| {
        let classes = resolve_type_classes(files, &TYPE_PATHS);
        assert_eq!(classes.len(), TYPE_PATHS.len() - 1);
        let mut indexes = classes.values().map(|class| class.class);
        assert!(indexes.all(|class| class != BuiltinClassIndex(WEAK_REF)));
    });
}

#[test]
fn program_class_has_no_class() {
    const PROGRAM: &[Declaration] = &[Declaration::Exported(&[class("Map")])];
    with_files(&[LIBRARY, module("/a.ts", PROGRAM)], |files| {
        let classes = resolve_type_classes(files, &TYPE_PATHS);
        assert_eq!(classes.get(&class_symbol(files, "/a.ts", "Map")), None);
        let library_type = interface_symbol(files, LIBRARY_PATH, "Map");
        assert_eq!(classes.get(&library_type).copied(), exact(MAP));
    });
}

#[test]
fn runtime_declaration_of_global_name_removes_class() {
    const CLASS: &[Declaration] = &[class("Map")];
    const VARIABLE: &[Declaration] = &[Declaration::Variable {
        name: "Map",
        annotation: Annotation::Any,
    }];
    const FUNCTION: &[Declaration] = &[function("Map", true)];
    for program in [CLASS, VARIABLE, FUNCTION] {
        let sources = [LIBRARY, script("/script.ts", program)];
        let classes = classes_of_library_types(&sources, &["Map", "Set"]);
        assert_eq!(classes, [None, exact(SET)]);
    }
}

#[test]
fn ambient_declaration_of_global_name_keeps_class() {
    const CLASS: &[Declaration] = &[Declaration::Declared(&[class("Map")])];
    const VARIABLE: &[Declaration] = &[Declaration::Declared(&[variable("Map", "Set")])];
    const FUNCTION: &[Declaration] = &[Declaration::Declared(&[function("Map", false)])];
    const INTERFACE: &[Declaration] = &[interface("Map")];
    for program in [CLASS, VARIABLE, FUNCTION, INTERFACE] {
        let sources = [LIBRARY, script("/script.ts", program)];
        assert_eq!(classes_of_library_types(&sources, &["Map"]), [exact(MAP)]);
    }
}

#[test]
fn augmented_library_type_keeps_class() {
    const AUGMENTATION: &[Declaration] = &[Declaration::GlobalAugmentation(&[callable(
        "Set",
        &[],
        &[Signature::Method("extra")],
    )])];
    let sources = [LIBRARY, module("/a.ts", AUGMENTATION)];
    let classes = classes_of_library_types(&sources, &["Set", "Map"]);
    assert_eq!(classes, [exact(SET), exact(MAP)]);
}

#[test]
fn unknown_ambient_subtype_makes_type_view() {
    const INTERFACE: &[Declaration] = &[subinterface("Registry", &["Map"])];
    const EXTENDING_CLASS: &[Declaration] = &[Declaration::Class {
        name: "Registry",
        extends: Some("Map"),
        implements: &[],
    }];
    const IMPLEMENTING_CLASS: &[Declaration] = &[Declaration::Class {
        name: "Registry",
        extends: None,
        implements: &["Set", "Map"],
    }];
    for (subtype, set) in [
        (INTERFACE, exact(SET)),
        (EXTENDING_CLASS, exact(SET)),
        (IMPLEMENTING_CLASS, view(SET)),
    ] {
        let sources = [LIBRARY, script("/registry.d.ts", subtype)];
        let classes = classes_of_library_types(&sources, &["Map", "Set", "Error"]);
        assert_eq!(classes, [view(MAP), set, exact(ERROR)]);
    }
}

#[test]
fn unknown_subtype_in_default_library_keeps_type_exact() {
    const SUBTYPE: &[Declaration] = &[subinterface("HighlightRegistry", &["Map"])];
    let sources = [LIBRARY, script("/library/lib.dom.d.ts", SUBTYPE)];
    let host = DeclarationsHost { files: &sources };
    let session = Session::new();
    let options = Options {
        lib_dir: b"/library".to_vec(),
        libs: vec![b"dom".to_vec()],
        ..Options::default()
    };
    let roots = [LIBRARY_PATH.as_bytes().to_vec()];
    let files = Files::load(&session, None, &host, options, &roots, &|_| {});
    assert!(
        files
            .module(file_at(&files, "/library/lib.dom.d.ts"))
            .is_lib
    );
    let classes = resolve_type_classes(&files, &TYPE_PATHS);
    let map = interface_symbol(&files, LIBRARY_PATH, "Map");
    assert_eq!(classes.get(&map).copied(), exact(MAP));
}

#[test]
fn symbols_list_each_class_with_final_denotation() {
    const SUBTYPE: &[Declaration] = &[subinterface("Registry", &["Map"])];
    with_files(&[LIBRARY, script("/registry.d.ts", SUBTYPE)], |files| {
        let symbols = BuiltinTypeSymbols::compute(files, &TYPE_PATHS, &[]);
        let listed: Vec<(Sym, BuiltinTypeClass)> = symbols.classes().collect();
        assert_eq!(listed.len(), TYPE_PATHS.len() - 1);
        for &(symbol, class) in &listed {
            assert_eq!(symbols.class_of(symbol), Some(class));
        }
        let listed_classes_of = |name: &str| -> Vec<Option<BuiltinTypeClass>> {
            let symbol = interface_symbol(files, LIBRARY_PATH, name);
            let entries = listed.iter().filter(|(candidate, _)| *candidate == symbol);
            entries.map(|&(_, class)| Some(class)).collect()
        };
        assert_eq!(listed_classes_of("Map"), [view(MAP)]);
        assert_eq!(listed_classes_of("Set"), [exact(SET)]);
        assert_eq!(listed_classes_of("PropertyDescriptor"), []);
    });
}

#[test]
fn table_subtype_keeps_type_exact() {
    let classes = classes_of_library_types(&[LIBRARY], &["Error", "TypeError"]);
    assert_eq!(classes, [exact(ERROR), exact(TYPE_ERROR)]);
}

#[test]
fn unknown_subtype_of_table_subtype_makes_every_base_view() {
    const SUBTYPE: &[Declaration] = &[subinterface("HttpError", &["TypeError"])];
    let sources = [LIBRARY, script("/http.d.ts", SUBTYPE)];
    let classes = classes_of_library_types(&sources, &["TypeError", "Error", "Map"]);
    assert_eq!(classes, [view(TYPE_ERROR), view(ERROR), exact(MAP)]);
}

#[test]
fn subtype_in_program_file_keeps_type_exact() {
    const SUBTYPES: &[Declaration] = &[
        subinterface("Registry", &["Map"]),
        Declaration::Class {
            name: "Cache",
            extends: Some("Map"),
            implements: &["Set"],
        },
    ];
    for program in [script("/a.ts", SUBTYPES), module("/a.ts", SUBTYPES)] {
        let classes = classes_of_library_types(&[LIBRARY, program], &["Map", "Set"]);
        assert_eq!(classes, [exact(MAP), exact(SET)]);
    }
}

#[test]
fn program_subtypes_are_interfaces_of_files_with_code() {
    const DECLARED: &[Declaration] = &[subinterface("Registry", &["Map"])];
    const PROGRAM: &[Declaration] = &[
        interface("Range"),
        subinterface("Index", &["Range", "Map"]),
        subinterface("NamedIndex", &["Index"]),
        subinterface("Failure", &["TypeError"]),
        subinterface("Span", &["Range"]),
        subinterface("Listed", &["Registry"]),
    ];
    let sources = [
        LIBRARY,
        script("/registry.d.ts", DECLARED),
        module("/a.ts", PROGRAM),
    ];
    with_files(&sources, |files| {
        let symbols = BuiltinTypeSymbols::compute(files, &TYPE_PATHS, &[]);
        let expected = ["Index", "NamedIndex", "Failure", "Listed"];
        let expected = expected.map(|name| interface_symbol(files, "/a.ts", name));
        assert_eq!(symbols.program_subtypes(), expected);
        for &subtype in symbols.program_subtypes() {
            assert!(can_list_declarations_of(files, subtype.file));
        }
        assert!(!can_list_declarations_of(
            files,
            file_at(files, "/registry.d.ts")
        ));
    });
}

#[test]
fn file_without_heritage_or_static_members_is_listed_nowhere() {
    const PROGRAM: &[Declaration] = &[interface("Range"), class("Cache")];
    with_files(&[LIBRARY, module("/a.ts", PROGRAM)], |files| {
        assert!(!can_list_declarations_of(files, file_at(files, "/a.ts")));
    });
}

#[test]
fn namespaced_type_is_found() {
    const OTHER: &[Declaration] = &[interface("DateTimeFormat")];
    with_files(&[LIBRARY, script("/other.d.ts", OTHER)], |files| {
        let classes = resolve_type_classes(files, &TYPE_PATHS);
        let namespaced = interface_symbol(files, LIBRARY_PATH, "DateTimeFormat");
        assert_eq!(classes.get(&namespaced).copied(), exact(DATE_TIME_FORMAT));
        let global = interface_symbol(files, "/other.d.ts", "DateTimeFormat");
        assert_eq!(classes.get(&global), None);
    });
}

#[test]
fn subtype_names_namespaced_type_by_qualified_name() {
    const INTERFACE: &[Declaration] = &[subinterface("Formatter", &["Intl.DateTimeFormat"])];
    const CLASS: &[Declaration] = &[Declaration::Class {
        name: "Formatter",
        extends: Some("Intl.DateTimeFormat"),
        implements: &[],
    }];
    for subtype in [INTERFACE, CLASS] {
        let sources = [LIBRARY, script("/formatter.d.ts", subtype)];
        let classes = classes_of_library_types(&sources, &["DateTimeFormat", "Map"]);
        assert_eq!(classes, [view(DATE_TIME_FORMAT), exact(MAP)]);
    }
}

#[test]
fn module_type_is_found() {
    const SQLITE: &[Declaration] = &[
        Declaration::AmbientModule {
            specifier: "bun:sqlite",
            body: &[class("Database"), class("Statement")],
        },
        interface("Database"),
    ];
    let of_module = |module: &'static str| BuiltinTypePath {
        module: Some(module),
        ..type_path(DATABASE, &["Database"], Denotation::Exact)
    };
    with_files(&[script("/sqlite.d.ts", SQLITE)], |files| {
        let classes = resolve_type_classes(files, &[of_module("bun:sqlite")]);
        let database = class_symbol(files, "/sqlite.d.ts", "Database");
        assert_eq!(classes.get(&database).copied(), exact(DATABASE));
        assert_eq!(classes.len(), 1);
        assert!(resolve_type_classes(files, &[of_module("bun:missing")]).is_empty());
    });
}

#[test]
fn view_path_stays_view() {
    let classes = classes_of_library_types(&[LIBRARY], &["ReadonlyMap"]);
    let expected = BuiltinTypeClass {
        class: BuiltinClassIndex(MAP),
        type_name: READONLY_MAP_TYPE_NAME,
        denotation: Denotation::View,
    };
    assert_eq!(classes, [Some(expected)]);
}

#[test]
fn first_path_of_symbol_stays() {
    let paths = [
        type_path(MAP, &["Map"], Denotation::View),
        BuiltinTypePath {
            type_name: READONLY_MAP_TYPE_NAME,
            ..type_path(MAP, &["Map"], Denotation::Exact)
        },
    ];
    with_files(&[LIBRARY], |files| {
        let classes = resolve_type_classes(files, &paths);
        let map = interface_symbol(files, LIBRARY_PATH, "Map");
        assert_eq!(classes.get(&map).copied(), view(MAP));
        assert_eq!(classes.len(), 1);
    });
}

#[test]
fn symbol_has_requested_meaning() {
    const VALUES: &[Declaration] = &[variable("process", "Map")];
    with_files(&[LIBRARY, script("/values.d.ts", VALUES)], |files| {
        let map = interface_symbol(files, LIBRARY_PATH, "Map");
        assert_eq!(
            find_symbol(files, None, &["Map"], SymFlags::TYPE),
            Some(map)
        );
        assert_eq!(find_symbol(files, None, &["Map"], SymFlags::VALUE), None);
        assert!(find_symbol(files, None, &["process"], SymFlags::VALUE).is_some());
        assert_eq!(find_symbol(files, None, &["process"], SymFlags::TYPE), None);
        assert_eq!(find_symbol(files, None, &[], SymFlags::TYPE), None);
    });
}

#[test]
fn call_signatures_of_declared_type_have_value() {
    let values = [
        value_path(10, Some("bun"), &["sql"]),
        value_path(11, Some("bun"), &["postgres"]),
    ];
    let found = values_of_call_signatures(SQL_MODULE, &values);
    assert_eq!(found, [None, Some(10), Some(10), None]);
}

#[test]
fn call_signatures_follow_annotation_of_each_value() {
    const DECLARATIONS: &[Declaration] = &[Declaration::AmbientModule {
        specifier: "bun",
        body: &[
            callable("First", &[], &[Signature::Call]),
            callable("Second", &[], &[Signature::Call]),
            variable("sql", "First"),
            variable("postgres", "Second"),
        ],
    }];
    let values = [
        value_path(10, Some("bun"), &["sql"]),
        value_path(11, Some("bun"), &["postgres"]),
    ];
    let found = values_of_call_signatures(DECLARATIONS, &values);
    assert_eq!(found, [Some(10), Some(11)]);
}

#[test]
fn variable_without_interface_type_has_no_call_signature() {
    const ALIAS: &[Declaration] = &[Declaration::AmbientModule {
        specifier: "bun",
        body: &[
            callable("Callable", &[], &[Signature::Call]),
            Declaration::TypeAlias {
                name: "Alias",
                target: "Callable",
            },
            variable("sql", "Alias"),
        ],
    }];
    const KEYWORD: &[Declaration] = &[Declaration::AmbientModule {
        specifier: "bun",
        body: &[
            callable("Callable", &[], &[Signature::Call]),
            Declaration::Variable {
                name: "sql",
                annotation: Annotation::Any,
            },
        ],
    }];
    let values = [value_path(10, Some("bun"), &["sql"])];
    for declarations in [ALIAS, KEYWORD] {
        assert_eq!(values_of_call_signatures(declarations, &values), [None]);
    }
}

#[test]
fn program_without_declarations_has_no_call_signature() {
    let values = [
        value_path(10, Some("bun"), &["sql"]),
        value_path(11, None, &["fetch"]),
    ];
    with_files(&[LIBRARY], |files| {
        assert!(collect_call_signatures(files, &values).is_empty());
    });
}

#[test]
fn function_declarations_are_own_signatures() {
    const FUNCTIONS: &[Declaration] = &[
        function("fetch", false),
        function("fetch", false),
        function("other", false),
    ];
    let sources = [script("/globals.d.ts", FUNCTIONS)];
    let values = [value_path(3, None, &["fetch"])];
    let found = values_of_functions(&sources, "/globals.d.ts", &values);
    assert_eq!(found, [Some(3), Some(3), None]);
}

#[test]
fn method_of_annotated_type_is_own_signature() {
    const JSON: &[Declaration] = &[
        callable(
            "JSON",
            &[],
            &[Signature::Method("parse"), Signature::Method("stringify")],
        ),
        variable("JSON", "JSON"),
    ];
    let sources = [script("/globals.d.ts", JSON)];
    let values = [value_path(7, None, &["JSON", "stringify"])];
    let found = values_of_functions(&sources, "/globals.d.ts", &values);
    assert_eq!(found, [None, Some(7)]);
}

#[test]
fn runtime_declaration_of_global_value_removes_signatures() {
    const DECLARED: &[Declaration] = &[function("fetch", false)];
    const REPLACED: &[Declaration] = &[function("fetch", true)];
    let values = [value_path(3, None, &["fetch"])];
    let declared = [script("/globals.d.ts", DECLARED)];
    assert_eq!(
        values_of_functions(&declared, "/globals.d.ts", &values),
        [Some(3)]
    );
    let replaced = [declared[0], script("/script.ts", REPLACED)];
    assert_eq!(
        values_of_functions(&replaced, "/globals.d.ts", &values),
        [None]
    );
}
