use super::*;
use crate::modules::commonjs_exports::{CommonJsInput, scan_commonjs_modules};
use crate::modules::module_set::collect_modules;
use crate::modules::order::compute_order;
use crate::modules::requests::scan_files;
use crate::modules::testing::{describe_module, file_named, with_graph};
use crate::modules::{BindInput, ExportLookup, ModuleFailure};
use bstr::BString;
use bun_core::strings;
use bun_sema::bind::SymbolId;
use bun_sema::hir::ExportId;
use bun_sema::import_sites::ImportSiteKind;

const UNCOMPILED_MODULE: &str = "https://example.com/x.js";
const HOST_VALUE_MODULE: &str = "bun:main";

const PROGRAM: [(&str, &str); 34] = [
    (
        "main.js",
        "import { both } from './collide'; import missing from './local';\n\
         import { ns } from './mixed'; import { x } from './cd';\n\
         import './same'; import './deep'; import './loop1'; import './as_ns';\n\
         import './alike'; import './again'; import './circular1'; import './typed';\n\
         import './untyped'; import './indirect1'; import './indirect2'; import './ca';\n\
         import './outer'; import './buffer'; console.log(both, missing, ns, x)",
    ),
    ("a.js", "export const a = 1, both = 2; export default 3"),
    ("b.js", "export const b = 1, both = 2; export default 3"),
    ("collide.js", "export * from './a'; export * from './b'"),
    ("local.js", "export * from './a'; export const both = 0"),
    ("one1.js", "export { a as one } from './a'"),
    ("one2.js", "export { a as one } from './a'"),
    ("same.js", "export * from './one1'; export * from './one2'"),
    ("deep.js", "export * from './deep1'"),
    ("deep1.js", "export * from './deep2'; export const d1 = 1"),
    ("deep2.js", "export const d2 = 2"),
    ("loop1.js", "export * from './loop2'; export const x1 = 1"),
    ("loop2.js", "export * from './loop1'; export const x2 = 2"),
    (
        "as_ns.js",
        "export * as A from './a'; export * as default from './b'",
    ),
    ("ns0.js", "import * as ns from './a'; export { ns }"),
    ("ns1.js", "export * as ns from './a'"),
    ("ns2.js", "export * as ns from './a'"),
    ("mixed.js", "export * from './ns0'; export * from './ns1'"),
    ("alike.js", "export * from './ns1'; export * from './ns2'"),
    ("again.js", "import d, { a } from './a'; export { d, a }"),
    ("circular1.js", "export { x } from './circular2'"),
    ("circular2.js", "export { x } from './circular1'"),
    ("types.ts", "export interface T {} export const value = 1"),
    ("typed.ts", "export { T, value } from './types'"),
    ("untyped.js", "export { T, value } from './types'"),
    ("c.cjs", "exports.c1 = 1"),
    ("d.cjs", "exports.d1 = 1"),
    ("wrap.js", "export * from './c.cjs'; export const own = 1"),
    ("cd.js", "export * from './c.cjs'; export * from './d.cjs'"),
    ("ca.js", "export * from './c.cjs'; export * from './a'"),
    ("indirect1.js", "export { c1 } from './wrap'"),
    ("indirect2.js", "export { x as y } from './cd'"),
    ("outer.js", "export * from './wrap'"),
    ("buffer.js", "export { Buffer } from 'node:buffer'"),
];

fn lines_after(prefix: &str, description: &str) -> Vec<BString> {
    let lines = strings::split(description.as_bytes(), b"\n");
    let lines = lines.filter_map(|line| line.strip_prefix(prefix.as_bytes()));
    lines.map(BString::from).collect()
}

fn with_export_tables(
    files: &[(&str, &str)],
    check: impl FnOnce(&ExportTables, &ModuleSet, &BindInput<'_, '_>),
) {
    with_graph(files, |_, input| {
        let scans = scan_files(input);
        let modules = collect_modules(input, &scans);
        let (order, _) = compute_order(input, &scans, &modules);
        let texts = scan_commonjs_modules(&CommonJsInput {
            bind: input,
            scans: &scans,
            modules: &modules,
            inner_modules: &|_| &[],
            half: &|module| order.half(module),
            is_prefix_root: &|_| true,
        });
        let entries = collect_export_entries(input, &scans, &modules);
        let tables = resolve_exports(&scans, &modules, entries, &texts);
        check(&tables, &modules, input);
    });
}

fn external_of(input: &BindInput<'_, '_>, importer: &str, specifier: &str) -> ModuleRef {
    ModuleRef::External {
        importer: file_named(input, importer),
        specifier: input.files.atoms.intern(specifier.as_bytes()),
    }
}

fn fake_atoms<const COUNT: usize>() -> [Atom; COUNT] {
    core::array::from_fn(|index| Atom((1 << 20) + index as u32))
}

fn external(importer: u32, specifier: Atom) -> ModuleRef {
    ModuleRef::External {
        importer: FileId(importer),
        specifier,
    }
}

fn variable(file: u32) -> Resolution {
    Resolution::Variable(Sym {
        file: FileId(file),
        id: SymbolId(0),
    })
}

fn binding_summary(binding: Resolution) -> Summary {
    Summary {
        binding,
        ..Summary::EMPTY
    }
}

fn provider_summary(provider: Resolution) -> Summary {
    Summary {
        provider,
        ..Summary::EMPTY
    }
}

fn required(resolution: Resolution, (module, name): NodeKey) -> ResolvedName {
    ResolvedName {
        resolution,
        required_name: Some(RequiredName::new(ModuleRef::File(module), name)),
    }
}

#[test]
fn exports_follow_resolve_export() {
    let expected: [(&str, &[&str]); 21] = [
        ("collide.js", &["a = a.js#a star", "b = b.js#b star"]),
        ("local.js", &["a = a.js#a star", "both = local.js#both"]),
        ("same.js", &["one = a.js#a star"]),
        (
            "deep.js",
            &["d1 = deep1.js#d1 star", "d2 = deep2.js#d2 star"],
        ),
        ("loop1.js", &["x1 = loop1.js#x1", "x2 = loop2.js#x2 star"]),
        ("loop2.js", &["x1 = loop1.js#x1 star", "x2 = loop2.js#x2"]),
        (
            "as_ns.js",
            &["A = namespace a.js", "default = namespace b.js"],
        ),
        ("ns0.js", &["ns = namespace a.js"]),
        ("alike.js", &["ns = namespace a.js star"]),
        ("mixed.js", &["ns = namespace a.js star"]),
        ("again.js", &["a = a.js#a", "d = a.js#default"]),
        ("circular1.js", &[]),
        ("typed.ts", &["value = types.ts#value"]),
        ("untyped.js", &["value = types.ts#value"]),
        ("wrap.js", &["own = wrap.js#own"]),
        ("indirect1.js", &["c1 = synthetic c.cjs c1"]),
        ("cd.js", &[]),
        ("indirect2.js", &[]),
        (
            "ca.js",
            &[
                "a = a.js#a star can-be-ambiguous",
                "both = a.js#both star can-be-ambiguous",
            ],
        ),
        ("outer.js", &["own = wrap.js#own star"]),
        (
            "buffer.js",
            &["Buffer = synthetic runtime:NodeBuffer Buffer"],
        ),
    ];
    with_graph(&PROGRAM, |graph, input| {
        for (file, exports) in expected {
            let lines = lines_after("export ", &describe_module(graph, input, file));
            assert_eq!(lines, exports, "{file}");
        }
    });
}

#[test]
fn exports_ascend_by_code_units() {
    let files = [
        (
            "main.js",
            "export * from './more.js'; export const b = 1, _ = 2, Z = 3;",
        ),
        ("more.js", "export const a = 1, $ = 2, aa = 3;"),
    ];
    with_graph(&files, |graph, input| {
        let exports = graph.exports(file_named(input, "main.js")).iter();
        let names: Vec<&[u8]> = exports
            .map(|export| input.files.atoms.bytes(export.name))
            .collect();
        assert_eq!(names, [&b"$"[..], b"Z", b"_", b"a", b"aa", b"b"]);
    });
}

#[test]
fn commonjs_star_names_resolve_at_run_time() {
    with_graph(&PROGRAM, |graph, input| {
        let describe = |file| describe_module(graph, input, file);
        for importer in ["main.js", "indirect2.js"] {
            let lines = lines_after("required ", &describe(importer));
            assert_eq!(lines, ["cd.js x"], "{importer}");
        }
        assert!(lines_after("required ", &describe("indirect1.js")).is_empty());
        let requests = lines_after("request ", &describe("outer.js"));
        assert_eq!(requests, ["wrap.js dynamic-star"]);
        assert_eq!(lines_after("request ", &describe("deep.js")), ["deep1.js"]);
    });
}

#[test]
fn unresolved_names_are_link_failures() {
    let expected = [
        ("main.js", true, "collide.js", "both"),
        ("main.js", false, "local.js", "default"),
        ("circular1.js", false, "circular2.js", "x"),
        ("circular2.js", false, "circular1.js", "x"),
        ("untyped.js", false, "types.ts", "T"),
    ];
    let describe = |failure: &ModuleFailure| match failure.kind {
        ModuleFailureKind::ExportNotFound { exporter, name } => {
            (failure.importer, false, exporter, name)
        }
        ModuleFailureKind::ExportAmbiguous { exporter, name } => {
            (failure.importer, true, exporter, name)
        }
        _ => {
            panic!("{failure:?}")
        }
    };
    with_graph(&PROGRAM, |graph, input| {
        let errors: Vec<_> = graph.errors().iter().map(describe).collect();
        assert_eq!(errors.len(), expected.len(), "{errors:?}");
        for (importer, is_ambiguous, exporter, name) in expected {
            let [importer, exporter] = [importer, exporter].map(|it| file_named(input, it));
            let name = input.files.atoms.intern(name.as_bytes());
            let error = (importer, is_ambiguous, ModuleRef::File(exporter), name);
            assert!(errors.contains(&error), "{error:?}");
        }
        assert!(graph.failures().is_empty());
        let circular = file_named(input, "circular1.js");
        let mut errors = graph.errors().iter();
        let error = errors.find(|error| error.importer == circular);
        let error = error.expect("circular1.js has an error");
        assert_eq!(error.site, ImportSiteKind::ExportFrom(ExportId(0)));
        assert_eq!((error.start, error.end), (9, 10));
    });
}

#[test]
fn unloadable_modules_add_no_names() {
    let barrel = "export * from './gone'; export * as ns from './gone';\n\
                  export { x } from './gone'; export const own = 1";
    let files = [("main.js", "import './barrel'"), ("barrel.js", barrel)];
    with_graph(&files, |graph, input| {
        let description = describe_module(graph, input, "barrel.js");
        let exports = lines_after("export ", &description);
        assert_eq!(exports, ["own = barrel.js#own"]);
        assert!(lines_after("request ", &description).is_empty());
        let atoms = &input.files.atoms;
        let module = ModuleRef::File(file_named(input, "barrel.js"));
        let lookup = graph.find_export(module, atoms.intern(b"absent"), atoms);
        assert_eq!(lookup, ExportLookup::Absent);
        let is_unresolved =
            |error: &ModuleFailure| matches!(error.kind, ModuleFailureKind::Unresolved { .. });
        assert_eq!(graph.errors().len(), 3);
        assert!(graph.errors().iter().all(is_unresolved));
        assert!(graph.failures().is_empty());
    });
}

#[test]
fn declaration_file_exports_no_names() {
    let main = "import { x } from './types.d.ts'; console.log(x)";
    let files = [
        ("main.js", main),
        ("types.d.ts", "export declare const x: number"),
    ];
    with_graph(&files, |graph, input| {
        let types = file_named(input, "types.d.ts");
        assert!(graph.exports(types).is_empty());
        let [error] = graph.errors() else {
            panic!("{:?}", graph.errors());
        };
        let ModuleFailureKind::ExportNotFound { exporter, name } = error.kind else {
            panic!("{error:?}");
        };
        assert_eq!(exporter, ModuleRef::File(types));
        assert_eq!(name, input.files.atoms.intern(b"x"));
    });
}

#[test]
fn names_of_commonjs_file_resolve_at_run_time() {
    let files = [
        ("main.js", "import './legacy.cjs'"),
        ("legacy.cjs", "exports.x = 1"),
    ];
    with_export_tables(&files, |tables, modules, input| {
        let legacy = file_named(input, "legacy.cjs");
        let module = ModuleRef::File(legacy);
        assert!(tables.has_dynamic_names(module));
        assert!(tables.names(legacy).is_empty());
        for name in [input.files.atoms.intern(b"x"), known::default] {
            let expected = ResolvedName::new(Resolution::Synthetic { module, name });
            assert_eq!(expected.required_name, None);
            assert_eq!(tables.resolve(modules, legacy, name), expected);
            assert_eq!(tables.resolve_in(modules, module, name), expected);
        }
    });
}

#[test]
fn json_keys_are_static_exports() {
    let main = "import { x } from './barrel.js'; import { absent } from './data.json';\n\
                console.log(x, absent)";
    let files = [
        ("main.js", main),
        ("barrel.js", "export * from './data.json'"),
        ("data.json", r#"{ "y": 1, "x": 2 }"#),
    ];
    with_graph(&files, |graph, input| {
        let atoms = &input.files.atoms;
        let [data, barrel] = ["data.json", "barrel.js"].map(|name| file_named(input, name));
        let names_of = |file| -> Vec<&[u8]> {
            let exports = graph.exports(file).iter();
            exports.map(|export| atoms.bytes(export.name)).collect()
        };
        assert_eq!(names_of(data), [&b"default"[..], b"x", b"y"]);
        assert_eq!(names_of(barrel), [b"x", b"y"]);
        assert!(!graph.has_dynamic_names(data));
        assert!(!graph.has_dynamic_names(barrel));
        for export in graph.exports(barrel) {
            assert!(export.is_from_star_export && !export.can_be_ambiguous);
            let own_entry = graph.find_export(ModuleRef::File(data), export.name, atoms);
            assert_eq!(own_entry, ExportLookup::Found(export.binding));
            assert!(matches!(
                export.binding,
                ExportBinding::Variable(symbol) if symbol.file == data
            ));
        }
        let requests = lines_after("request ", &describe_module(graph, input, "barrel.js"));
        assert_eq!(requests, ["data.json"]);
        let [error] = graph.errors() else {
            panic!("{:?}", graph.errors());
        };
        let ModuleFailureKind::ExportNotFound { exporter, name } = error.kind else {
            panic!("{error:?}");
        };
        assert_eq!(exporter, ModuleRef::File(data));
        assert_eq!(name, atoms.intern(b"absent"));
    });
}

#[test]
fn name_of_uncompiled_code_is_live() {
    let main = format!("import {{ x }} from '{UNCOMPILED_MODULE}'; console.log(x)");
    with_export_tables(&[("main.js", main.as_str())], |tables, modules, input| {
        let module = external_of(input, "main.js", UNCOMPILED_MODULE);
        assert!(tables.has_dynamic_names(module));
        for name in [input.files.atoms.intern(b"x"), known::default] {
            let resolved = tables.resolve_in(modules, module, name);
            assert_eq!(resolved.resolution, Resolution::LiveName { module, name });
            assert_eq!(
                resolved.required_name,
                Some(RequiredName::new(module, name))
            );
            assert!(!resolved.can_be_ambiguous());
        }
    });
}

#[test]
fn star_over_uncompiled_code_is_dynamic() {
    let barrel = format!("export * from '{UNCOMPILED_MODULE}'; export const own = 1");
    let files = [
        ("main.js", "import './barrel.js'"),
        ("barrel.js", barrel.as_str()),
    ];
    with_graph(&files, |graph, input| {
        let description = describe_module(graph, input, "barrel.js");
        let requests = lines_after("request ", &description);
        assert_eq!(
            requests,
            [format!("external:{UNCOMPILED_MODULE} dynamic-star")]
        );
        assert_eq!(
            lines_after("export ", &description),
            ["own = barrel.js#own"]
        );
        let atoms = &input.files.atoms;
        let barrel = file_named(input, "barrel.js");
        assert!(graph.has_dynamic_names(barrel));
        let module = ModuleRef::File(barrel);
        let find = |name: &[u8]| graph.find_export(module, atoms.intern(name), atoms);
        assert_eq!(find(b"x"), ExportLookup::Unknown);
        assert_eq!(find(b"default"), ExportLookup::Absent);
    });
    with_export_tables(&files, |tables, modules, input| {
        let module = external_of(input, "barrel.js", UNCOMPILED_MODULE);
        let name = input.files.atoms.intern(b"x");
        let resolved = tables.resolve(modules, file_named(input, "barrel.js"), name);
        assert_eq!(
            resolved,
            ResolvedName::new(Resolution::LiveName { module, name })
        );
    });
}

#[test]
fn named_re_export_of_uncompiled_code_is_indirect() {
    let barrel = format!("export {{ x as y }} from '{UNCOMPILED_MODULE}'");
    let files = [
        ("main.js", "import './barrel.js'"),
        ("barrel.js", barrel.as_str()),
    ];
    with_graph(&files, |graph, input| {
        let module = external_of(input, "barrel.js", UNCOMPILED_MODULE);
        let [x, y] = [b"x", b"y"].map(|name| input.files.atoms.intern(name));
        let barrel = file_named(input, "barrel.js");
        let expected = ModuleExport {
            name: y,
            binding: ExportBinding::Indirect { module, name: x },
            is_from_star_export: false,
            can_be_ambiguous: false,
            is_read_from_object: true,
        };
        assert_eq!(graph.exports(barrel), [expected]);
        assert_eq!(graph.required_names(barrel), [RequiredName::new(module, x)]);
        assert!(!graph.has_dynamic_names(barrel));
        assert!(graph.synthetic_exports().is_empty());
        assert!(graph.errors().is_empty());
    });
}

#[test]
fn host_value_names_are_synthetic() {
    let barrel = format!("export {{ x }} from '{HOST_VALUE_MODULE}'");
    let files = [
        ("main.js", "import './barrel.js'"),
        ("barrel.js", barrel.as_str()),
    ];
    with_graph(&files, |graph, input| {
        let description = describe_module(graph, input, "barrel.js");
        let exports = lines_after("export ", &description);
        assert_eq!(
            exports,
            [format!("x = synthetic external:{HOST_VALUE_MODULE} x")]
        );
        assert!(lines_after("required ", &description).is_empty());
    });
    with_export_tables(&files, |tables, modules, input| {
        let module = external_of(input, "barrel.js", HOST_VALUE_MODULE);
        let name = input.files.atoms.intern(b"x");
        let resolved = tables.resolve_in(modules, module, name);
        assert_eq!(resolved.resolution, Resolution::Synthetic { module, name });
        assert_eq!(resolved.required_name, None);
    });
}

#[test]
fn external_bindings_with_one_specifier_are_compared_at_run_time() {
    let [package, other_package, name, other_name] = fake_atoms();
    let synthetic = |importer, specifier, name| Resolution::Synthetic {
        module: external(importer, specifier),
        name,
    };
    let namespace = |importer, specifier| Resolution::Namespace {
        module: external(importer, specifier),
        phase: ImportPhase::Evaluation,
    };
    let key = (FileId(0), name);
    let join = |a, b| binding_summary(a).join(binding_summary(b), key);
    let ambiguous = ResolvedName::new(Resolution::Ambiguous);

    let first = synthetic(1, package, name);
    let joined = join(first, synthetic(2, package, name));
    assert!(joined.has_unresolved_identity);
    assert_eq!(joined.resolve(), required(first, key));
    let joined = join(first, first);
    assert!(!joined.has_unresolved_identity);
    assert_eq!(joined.resolve(), ResolvedName::new(first));
    let joined = join(first, synthetic(2, other_package, name));
    assert_eq!(joined.resolve(), ambiguous);
    let joined = join(first, synthetic(2, package, other_name));
    assert_eq!(joined.resolve(), ambiguous);

    let first = namespace(1, package);
    let joined = join(first, namespace(2, package));
    assert_eq!(joined.resolve(), required(first, key));
    let joined = join(first, namespace(2, other_package));
    assert_eq!(joined.resolve(), ambiguous);
}

#[test]
fn live_name_beside_other_binding_is_compared_at_run_time() {
    let [package, other_package, name] = fake_atoms();
    let live_name = |importer, specifier| Resolution::LiveName {
        module: external(importer, specifier),
        name,
    };
    let key = (FileId(0), name);
    let join = |a, b| binding_summary(a).join(binding_summary(b), key);

    let first = live_name(1, package);
    let joined = join(first, first);
    assert!(!joined.has_unresolved_identity);
    assert_eq!(joined.resolve(), ResolvedName::new(first));

    let captured = Resolution::Synthetic {
        module: ModuleRef::File(FileId(3)),
        name,
    };
    let other_bindings = [
        live_name(2, package),
        live_name(2, other_package),
        variable(3),
        captured,
    ];
    for other in other_bindings {
        let joined = join(first, other);
        assert!(joined.has_unresolved_identity, "{other:?}");
        assert_eq!(joined.resolve(), required(first, key), "{other:?}");
        assert_eq!(
            join(other, first).resolve(),
            required(other, key),
            "{other:?}"
        );
    }

    let ambiguous = ResolvedName::new(Resolution::Ambiguous);
    assert_eq!(join(first, Resolution::Ambiguous).resolve(), ambiguous);
}

#[test]
fn existence_check_is_not_ambiguity() {
    let [specifier, name] = fake_atoms();
    let live_name = Resolution::LiveName {
        module: external(1, specifier),
        name,
    };
    let key = (FileId(0), name);
    for binding in [live_name, variable(1)] {
        assert!(
            !ResolvedName::new(binding).can_be_ambiguous(),
            "{binding:?}"
        );
        assert!(required(binding, key).can_be_ambiguous(), "{binding:?}");
    }
}

#[test]
fn third_external_binding_moves_comparison_to_join() {
    let [specifier, name] = fake_atoms();
    let binding_in = |importer| {
        binding_summary(Resolution::Synthetic {
            module: external(importer, specifier),
            name,
        })
    };
    let (inner_key, outer_key) = ((FileId(4), name), (FileId(5), name));
    let inner = binding_in(1).join(binding_in(2), inner_key);
    let passed_on = Summary::EMPTY.join(inner, outer_key);
    assert_eq!(passed_on.resolve(), required(inner.binding, inner_key));
    let outer = inner.join(binding_in(3), outer_key);
    assert_eq!(outer.resolve(), required(inner.binding, outer_key));
}

#[test]
fn external_providers_resolve_at_run_time() {
    let [specifier, name] = fake_atoms();
    let provider_in = |importer| {
        provider_summary(Resolution::Synthetic {
            module: external(importer, specifier),
            name,
        })
    };
    let module = FileId(0);
    let summary = provider_in(1).join(provider_in(2), (module, name));
    let dynamic_star = Resolution::DynamicStar { module, name };
    assert_eq!(summary.resolve(), required(dynamic_star, (module, name)));
}

#[test]
fn binding_beside_provider_is_compared_at_run_time() {
    let [name] = fake_atoms();
    let variable = variable(1);
    let synthetic = |file| Resolution::Synthetic {
        module: ModuleRef::File(FileId(file)),
        name,
    };
    let (inner_key, outer_key) = ((FileId(4), name), (FileId(5), name));
    let binding = binding_summary(variable);

    let inner = binding.join(provider_summary(synthetic(2)), inner_key);
    assert_eq!(inner.resolve(), required(variable, inner_key));
    assert!(!inner.has_unresolved_identity);
    for same_ends in [Summary::EMPTY, binding, inner] {
        let joined = inner.join(same_ends, outer_key);
        assert_eq!(joined.resolve(), required(variable, inner_key));
        let joined = same_ends.join(inner, outer_key);
        assert_eq!(joined.resolve(), required(variable, inner_key));
    }
    let joined = inner.join(provider_summary(synthetic(3)), outer_key);
    assert_eq!(joined.resolve(), required(variable, outer_key));
    let joined = inner.join(binding_summary(synthetic(3)), outer_key);
    assert_eq!(joined.resolve(), ResolvedName::new(Resolution::Ambiguous));

    let [first, second] = [2, 3].map(|file| provider_summary(synthetic(file)));
    let joined = first.join(second, inner_key).join(binding, outer_key);
    assert_eq!(joined.resolve(), required(variable, outer_key));
}

#[test]
fn provider_equal_to_binding_adds_no_end() {
    let [name] = fake_atoms();
    let synthetic = Resolution::Synthetic {
        module: ModuleRef::File(FileId(2)),
        name,
    };
    let key = (FileId(4), name);
    let joined = binding_summary(synthetic).join(provider_summary(synthetic), key);
    assert_eq!(joined.resolve(), ResolvedName::new(synthetic));
}

#[test]
fn star_name_stands_for_cycle_through_indirect_export() {
    let star = "export * from './indirect.js'; export * from './es.js'; export * from './c.cjs'";
    let files = [
        (
            "main.js",
            "import { x } from './indirect.js'; console.log(x)",
        ),
        ("indirect.js", "export { x } from './star.js'"),
        ("star.js", star),
        ("es.js", "export const x = 1"),
        ("c.cjs", "exports.x = 2"),
    ];
    with_graph(&files, |graph, input| {
        let describe = |file| describe_module(graph, input, file);
        for importer in ["main.js", "indirect.js"] {
            let lines = lines_after("required ", &describe(importer));
            assert_eq!(lines, ["star.js x"], "{importer}");
        }
        let exports = lines_after("export ", &describe("indirect.js"));
        assert_eq!(exports, ["x = es.js#x"]);
        let exports = lines_after("export ", &describe("star.js"));
        assert_eq!(exports, ["x = es.js#x star can-be-ambiguous"]);
        assert!(graph.errors().is_empty());
    });
}

#[test]
fn ambiguous_name_hides_commonjs_star_name() {
    let two_stars = "export * from './a.js'; export * from './b.js'";
    let stars = format!("{two_stars}; export * from './c.cjs'");
    let files = [
        (
            "main.js",
            "import './stars.js'; import './outer.js'; import './plain.js'",
        ),
        ("a.js", "export const x = 1, a = 1"),
        ("b.js", "export const x = 2"),
        ("c.cjs", "exports.x = 3"),
        ("stars.js", stars.as_str()),
        ("inner.js", two_stars),
        (
            "outer.js",
            "export * from './inner.js'; export * from './c.cjs'",
        ),
        ("plain.js", two_stars),
    ];
    let expected: [(&str, &[&str], &str, ExportLookup); 4] = [
        (
            "stars.js",
            &[
                "a.js dynamic-star",
                "b.js dynamic-star",
                "c.cjs dynamic-star",
            ],
            "a = a.js#a star can-be-ambiguous",
            ExportLookup::Unknown,
        ),
        (
            "outer.js",
            &["inner.js dynamic-star", "c.cjs dynamic-star"],
            "a = a.js#a star can-be-ambiguous",
            ExportLookup::Unknown,
        ),
        (
            "inner.js",
            &["a.js dynamic-star", "b.js dynamic-star"],
            "a = a.js#a star",
            ExportLookup::Absent,
        ),
        (
            "plain.js",
            &["a.js", "b.js"],
            "a = a.js#a star",
            ExportLookup::Absent,
        ),
    ];
    with_graph(&files, |graph, input| {
        let atoms = &input.files.atoms;
        let x = atoms.intern(b"x");
        for (file, requests, export, lookup) in expected {
            let description = describe_module(graph, input, file);
            assert_eq!(lines_after("request ", &description), requests, "{file}");
            assert_eq!(lines_after("export ", &description), [export], "{file}");
            assert!(lines_after("required ", &description).is_empty(), "{file}");
            let module = ModuleRef::File(file_named(input, file));
            assert_eq!(graph.find_export(module, x, atoms), lookup, "{file}");
        }
        assert!(graph.errors().is_empty());
    });
}

#[test]
fn imported_namespaces_of_two_modules_are_one_binding() {
    let holder = "import * as ns from './target.js'; export { ns }";
    let stars = "export * from './p.js'; export * from './q.js'; export * from './c.cjs'";
    let files = [
        ("main.js", "import './stars.js'"),
        ("target.js", "export const value = 1"),
        ("p.js", holder),
        ("q.js", holder),
        ("c.cjs", "exports.ns = 1"),
        ("stars.js", stars),
    ];
    with_graph(&files, |graph, input| {
        let description = describe_module(graph, input, "stars.js");
        let requests = lines_after("request ", &description);
        assert_eq!(requests, ["p.js", "q.js", "c.cjs dynamic-star"]);
        let exports = lines_after("export ", &description);
        assert_eq!(exports, ["ns = namespace target.js star can-be-ambiguous"]);
        assert!(lines_after("required ", &description).is_empty());
        assert!(graph.errors().is_empty());
    });
}

#[test]
fn ambiguous_binding_follows_every_star_only_beside_provider() {
    let [name] = fake_atoms();
    let [first, second] = [1, 2].map(|file| binding_summary(variable(file)));
    let provider = provider_summary(Resolution::Synthetic {
        module: ModuleRef::File(FileId(3)),
        name,
    });
    let key = (FileId(4), name);
    let ambiguous = first.join(second, key);
    assert_eq!(
        ambiguous.resolve(),
        ResolvedName::new(Resolution::Ambiguous)
    );
    assert!(!ambiguous.should_follow_every_star());
    assert!(!first.join(provider, key).should_follow_every_star());
    for joined in [ambiguous.join(provider, key), provider.join(ambiguous, key)] {
        assert_eq!(joined.resolve(), ResolvedName::new(Resolution::Ambiguous));
        assert!(joined.should_follow_every_star());
    }
}
