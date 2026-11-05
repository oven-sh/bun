use super::canonical::{CanonicalInput, canonical_function};
use super::find::{
    BindingValues, Certainty, FileHelpers, FindInput, KnownReference, find, find_global,
};
use super::published::{Helper, PUBLISHED_FUNCTIONS, Shape};
use super::resolve::{KnownCallee, ResolveInput, resolve_callee, resolve_reference};
use super::table::{Table, analyze, find_published_function};
use super::{KnownHelpers, Reference};
use crate::ir::run_serially;
use crate::modules::testing::{file_named, with_graph};
use bun_sema::hir::{ExprKind, StmtKind};

pub(super) const CREATE_BINDING: &str = r#"var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
"#;

pub(super) const EXPORT_STAR: &str = r#"var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
"#;

const ESBUILD_MODULE_HELPERS: &str = r#"var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
"#;

const ESBUILD_MODULE_SHAPES: [Shape; 3] = [
    Shape::ExportDefinesGetters,
    Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
    Shape::ToCommonJsCopiesOntoNewMarkedObject,
];

const SWC_EXPORT: &str = r#"function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
"#;

#[test]
fn the_export_helper_of_swc_is_known() {
    assert_eq!(
        shapes_in("/a.cjs", SWC_EXPORT),
        [Shape::ExportDefinesGetters]
    );
    let renamed = SWC_EXPORT
        .replace("_export", "e")
        .replace("target", "t")
        .replace("all", "a")
        .replace("name", "n");
    assert_eq!(shapes_in("/a.cjs", &renamed), [Shape::ExportDefinesGetters]);
    assert_eq!(
        shapes_in(
            "/a.cjs",
            &SWC_EXPORT.replace("enumerable: true", "enumerable: false")
        ),
        []
    );
}

const TYPEOF_THAT_REPLACES_ITSELF: &str = r#"function _typeof(o) {
  "@babel/helpers - typeof";
  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}
"#;

#[test]
fn whoever_reads_the_name_of_a_helper_that_replaces_itself_sees_which_function_it_holds() {
    let is_only_called = |path: &str, head: &str, more: &str| -> Vec<bool> {
        let found = find_in(path, &format!("{head}{TYPEOF_THAT_REPLACES_ITSELF}{more}"));
        let functions = found.functions();
        functions
            .map(|(_, known)| known.is_named_only_to_be_called)
            .collect()
    };
    let classic = "/** @jsxRuntime classic */\n/** @jsx pick */\n";
    let pick = "function pick(tag) { return tag; }\n";
    assert_eq!(is_only_called("/a.mjs", "", "_typeof(1);"), [true]);
    let element = format!("{pick}_typeof(<a />);");
    assert_eq!(is_only_called("/a.jsx", classic, &element), [true]);
    let fragment = format!("{classic}/** @jsxFrag _typeof */\n");
    let reads_fragment = format!("{pick}<></>;");
    for (path, head, more) in [
        ("/a.mjs", "", "const held = _typeof;"),
        ("/a.jsx", fragment.as_str(), reads_fragment.as_str()),
        (
            "/a.jsx",
            "/** @jsxRuntime classic */\n/** @jsx _typeof.toString */\n",
            "<a />;",
        ),
        ("/a.ts", "", "import held = _typeof;\nheld;"),
    ] {
        assert_eq!(is_only_called(path, head, more), [false], "{head}{more}");
    }
}

fn with_file<R>(path: &str, source: &str, then: impl FnOnce(&FindInput<'_, '_>) -> R) -> R {
    analyze(path, source, |input| {
        assert!(
            !input.hir.has_errors && !input.hir.has_parse_diagnostics,
            "syntax error in: {source}"
        );
        then(input)
    })
}

fn find_in(path: &str, source: &str) -> FileHelpers {
    with_file(path, source, |input| find(input))
}

fn shapes_in(path: &str, source: &str) -> Vec<Shape> {
    let found = find_in(path, source);
    found.functions().map(|(_, known)| known.shape).collect()
}

fn bindings_in<T>(path: &str, source: &str, read: impl Fn(&BindingValues) -> T) -> Vec<T> {
    let found = find_in(path, source);
    found.bindings().map(|(_, values)| read(values)).collect()
}

fn certainties_in(path: &str, source: &str) -> Vec<Certainty> {
    bindings_in(path, source, |values| values.certainty)
}

fn holds_in(path: &str, source: &str) -> Vec<bool> {
    bindings_in(path, source, |values| values.holds_from_the_start)
}

const TYPEOF: &str = r#"function _typeof(o) {
  "@babel/helpers - typeof";
  return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function (o) {
    return typeof o;
  } : function (o) {
    return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
  }, _typeof(o);
}"#;

#[test]
fn the_name_that_a_function_expression_gives_itself_takes_no_store() {
    let known = [Shape::TypeofAnswersSymbolForSymbols];
    assert_eq!(shapes_in("/a.mjs", TYPEOF), known);
    for keyword in ["var", "let", "const"] {
        let held = format!("{keyword} _typeof = {TYPEOF};");
        assert_eq!(shapes_in("/a.mjs", &held), [], "{keyword}");
        assert_eq!(shapes_in("/a.cjs", &held), [], "{keyword}");
    }
    // A name that nothing is stored to makes no difference.
    let export = SWC_EXPORT.trim_end();
    let held = format!("var _export = {export};");
    assert_eq!(shapes_in("/a.cjs", &held), [Shape::ExportDefinesGetters]);
}

#[test]
fn a_helper_that_replaces_the_exports_of_its_file_too_is_an_ordinary_function() {
    let changes = [
        ("return _typeof = ", "return module.exports = _typeof = "),
        (
            "}, _typeof(o);",
            "}, module.exports.__esModule = true, module.exports[\"default\"] = module.exports, _typeof(o);",
        ),
    ];
    assert_eq!(shapes_in("/a.cjs", &replace_each(TYPEOF, &changes)), []);
}

fn tree_of(function: &str) -> Vec<u8> {
    with_file("/a.cjs", &format!("var written = {function};"), |input| {
        let hir = input.hir;
        let statement = hir.ids(hir.body).next().expect("the file has a statement");
        let written = find_published_function(hir, statement);
        let written = written.expect("the value of the variable is a function");
        let canonical_input = CanonicalInput {
            file: input,
            max_bytes: usize::MAX,
            is_outer_name: &|_| false,
        };
        let canonical = canonical_function(&canonical_input, written);
        canonical.expect("every part of the function is read").bytes
    })
}

fn replace_each(source: &str, changes: &[(&str, &str)]) -> String {
    let mut changed = source.to_owned();
    for &(from, to) in changes {
        assert!(changed.contains(from), "{from}");
        changed = changed.replace(from, to);
    }
    changed
}

#[test]
fn every_published_function_is_read() {
    let (_, rejected) = Table::read(PUBLISHED_FUNCTIONS);
    let rejected: Vec<(Shape, &str)> = rejected
        .iter()
        .map(|&index| {
            (
                PUBLISHED_FUNCTIONS[index].shape,
                PUBLISHED_FUNCTIONS[index].origin,
            )
        })
        .collect();
    assert!(rejected.is_empty(), "{rejected:?}");
}

#[test]
fn no_tree_is_published_twice() {
    let (table, _) = Table::read(PUBLISHED_FUNCTIONS);
    let message = "two published texts are one tree";
    assert_eq!(table.entries.len(), PUBLISHED_FUNCTIONS.len(), "{message}");
}

#[test]
fn every_reference_of_a_published_function_can_be_verified() {
    let published: Vec<Helper> = PUBLISHED_FUNCTIONS
        .iter()
        .map(|function| function.shape.helper())
        .collect();
    for function in PUBLISHED_FUNCTIONS {
        for &(name, reference) in function.references {
            let can_be_verified = match reference {
                Reference::Helper(helper) => published.contains(&helper),
                Reference::Global(path) => find_global(path).is_some(),
            };
            assert!(
                can_be_verified,
                "{name} of {:?}, {}",
                function.shape, function.origin
            );
        }
    }
}

#[test]
fn emitted_text_is_recognized() {
    let source = format!("{CREATE_BINDING}{EXPORT_STAR}");
    assert_eq!(
        shapes_in("/a.cjs", &source),
        [
            Shape::CreateBindingReusesDescriptor,
            Shape::CreateBindingCopiesValue,
            Shape::ExportStarBindsNamesTheTargetLacks,
        ]
    );
}

#[test]
fn names_and_layout_of_the_text_do_not_matter() {
    let source = r#"
        const bind = function named(target, source, key, as) {
            if (as === undefined)
                as = key;
            var found = Object.getOwnPropertyDescriptor(source, key);
            if (!found || (('get' in found) ? !source.__esModule : (found.writable || found.configurable))) {
                found = { "enumerable": true, get: function () { return source[key] } }
            }
            Object.defineProperty(target, as, found)
        };
        function star(from, to) {
            for (var name in from)
                if (name !== 'default' && !Object.prototype.hasOwnProperty.call(to, name))
                    bind(to, from, name);
        }
    "#;
    assert_eq!(
        shapes_in("/a.cjs", source),
        [
            Shape::CreateBindingReusesDescriptor,
            Shape::ExportStarBindsNamesTheTargetLacks,
        ]
    );
    assert_eq!(
        certainties_in("/a.cjs", source),
        [Certainty::Always, Certainty::Always]
    );
}

#[test]
fn one_changed_place_makes_an_ordinary_function() {
    let changes = [
        ("enumerable: true", "enumerable: false"),
        ("return m[k];", "return m[k2];"),
        (
            "Object.getOwnPropertyDescriptor(m, k)",
            "Object.getOwnPropertyDescriptor(o, k)",
        ),
        (
            "desc.writable || desc.configurable",
            "desc.configurable || desc.writable",
        ),
        (
            "Object.defineProperty(o, k2, desc);",
            "Object.defineProperty(o, k2, desc); return o;",
        ),
        (
            "Object.defineProperty(o, k2, desc);",
            "Object.defineProperty(o, k2, desc); return undefined;",
        ),
        (
            "if (k2 === undefined) k2 = k;\n    var desc",
            "if (k2 == undefined) k2 = k;\n    var desc",
        ),
        ("!m.__esModule", "!m.__esmodule"),
        (
            "(function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var",
            "(function(o, m, k, k2, k3) {\n    if (k2 === undefined) k2 = k;\n    var",
        ),
        (
            "(function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var",
            "(function*(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var",
        ),
        (
            "(function(o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    var",
            "((o, m, k, k2) => {\n    if (k2 === undefined) k2 = k;\n    var",
        ),
    ];
    for (from, to) in changes {
        assert!(CREATE_BINDING.contains(from), "{from}");
        let shapes = shapes_in("/a.cjs", &CREATE_BINDING.replacen(from, to, 1));
        assert_eq!(shapes, [Shape::CreateBindingCopiesValue], "{to}");
    }
}

#[test]
fn an_export_star_that_differs_in_one_place_is_an_ordinary_function() {
    let below = [
        Shape::CreateBindingReusesDescriptor,
        Shape::CreateBindingCopiesValue,
    ];
    for (from, to) in [
        ("p !== \"default\" && ", ""),
        ("var p in m", "var p of Object.keys(m)"),
        (" && !Object.prototype.hasOwnProperty.call(exports, p)", ""),
        (
            "hasOwnProperty.call(exports, p)",
            "hasOwnProperty.call(m, p)",
        ),
        (
            "__createBinding(exports, m, p)",
            "__createBinding(exports, m, p, \"last\")",
        ),
    ] {
        let changed = replace_each(EXPORT_STAR, &[(from, to)]);
        let source = format!("{CREATE_BINDING}{changed}");
        assert_eq!(shapes_in("/a.cjs", &source), below, "{to}");
    }
}

#[test]
fn a_global_that_is_shadowed_is_no_global() {
    let source = format!("function outer(Object) {{ {CREATE_BINDING} return __createBinding; }}");
    assert_eq!(
        shapes_in("/a.cjs", &source),
        [Shape::CreateBindingCopiesValue]
    );
    let source = format!("var undefined = 1; {CREATE_BINDING}");
    assert_eq!(shapes_in("/a.mjs", &source), []);
    let source =
        format!("function outer(undefined) {{ {CREATE_BINDING} return __createBinding; }}");
    assert_eq!(shapes_in("/a.cjs", &source), []);
}

#[test]
fn a_global_that_evaluated_text_may_shadow_is_no_global() {
    let source = format!("function outer() {{ {CREATE_BINDING} return __createBinding; }}");
    let both = [
        Shape::CreateBindingReusesDescriptor,
        Shape::CreateBindingCopiesValue,
    ];
    assert_eq!(shapes_in("/a.cjs", &source), both);
    let source =
        format!("function outer(text) {{ eval(text); {CREATE_BINDING} return __createBinding; }}");
    assert_eq!(shapes_in("/a.cjs", &source), []);
}

#[test]
fn a_helper_that_calls_another_function_is_no_helper() {
    let source = format!("function __createBinding(o, m, k) {{ o[k] = m[k]; }}\n{EXPORT_STAR}");
    assert_eq!(shapes_in("/a.cjs", &source), []);
    assert_eq!(shapes_in("/a.cjs", EXPORT_STAR), []);
}

#[test]
fn a_binding_that_may_hold_something_else_says_so() {
    let source = format!("{CREATE_BINDING}{EXPORT_STAR}");
    let once = [Certainty::OnceInitialized, Certainty::OnceInitialized];
    assert_eq!(certainties_in("/a.cjs", &source), once);
    assert_eq!(
        certainties_in("/a.mjs", &format!("{source}export {{}};")),
        once
    );
    let uncertain = [Certainty::MayHoldOtherValues, Certainty::MayHoldOtherValues];
    let behind_a_call = format!("require(\"./b.cjs\");\n{source}");
    assert_eq!(certainties_in("/a.cjs", &behind_a_call), uncertain);
    let inherited = source.replace("this.__exportStar", "this.valueOf");
    let one_inherited = [Certainty::OnceInitialized, Certainty::MayHoldOtherValues];
    assert_eq!(certainties_in("/a.cjs", &inherited), one_inherited);
    let stored = format!("{source}export {{}}; __exportStar = null;");
    let stored_again = [Certainty::OnceInitialized, Certainty::MayHoldOtherValues];
    assert_eq!(certainties_in("/a.mjs", &stored), stored_again);
}

#[test]
fn a_variable_assigned_once_before_the_helper_is_created_is_initialized_first() {
    let source = r#"
        var bind, star;
        (function () {
            bind = Object.create ? (function(o, m, k, k2) {
                if (k2 === undefined) k2 = k;
                Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
            }) : (function(o, m, k, k2) {
                if (k2 === undefined) k2 = k;
                o[k2] = m[k];
            });
            star = function(m, o) {
                for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) bind(o, m, p);
            };
        })();
    "#;
    let found = find_in("/a.cjs", source);
    let star = found
        .functions()
        .find(|(_, known)| known.shape == Shape::ExportStarBindsNamesTheTargetLacks);
    let references = &star.expect("the helper is recognized").1.references;
    assert!(matches!(
        references[..],
        [KnownReference::Helper {
            is_initialized_first: true,
            ..
        }]
    ));
}

#[test]
fn forms_that_mean_the_same_are_one_tree() {
    let pairs = [
        (
            "function (a) { if (a) { a(); } }",
            "function (a) { if (a) a(); }",
        ),
        (
            "function (a) { for (;;) { { a(); } } }",
            "function (a) { for (;;) a(); }",
        ),
        (
            "function (a) { while (a()) {} }",
            "function (a) { while (a()); }",
        ),
        (
            "function (a) { { var b = a; } return b; }",
            "function (a) { var b = a; return b; }",
        ),
        ("(a) => { return a(); }", "(a) => a()"),
        ("(a) => { { return a(); } }", "(a) => a()"),
        (
            "function (a) { return a === void 0; }",
            "function (a) { return a === undefined; }",
        ),
        (
            "function () { return [!0, !1]; }",
            "function () { return [true, false]; }",
        ),
        (
            r#"function (a) { return typeof a == "object" || "function" != typeof a; }"#,
            r#"function (a) { return typeof a === "object" || "function" !== typeof a; }"#,
        ),
    ];
    for (one, other) in pairs {
        assert!(tree_of(one) == tree_of(other), "{one} | {other}");
    }
}

#[test]
fn forms_that_mean_something_else_are_two_trees() {
    let pairs = [
        (
            "function (a) { { let b = a; } }",
            "function (a) { let b = a; }",
        ),
        (
            "function (a) { { function b() {} } }",
            "function (a) { function b() {} }",
        ),
        ("function (a) { { a(); a(); } }", "function (a) { a(); }"),
        ("function (a) { return a(); }", "(a) => a()"),
        ("(a) => { a(); }", "(a) => a()"),
        (
            "function (a) { return void a(); }",
            "function (a) { return undefined; }",
        ),
        (
            "function (undefined) { return undefined; }",
            "function (a) { return void 0; }",
        ),
        ("function (a) { return !a; }", "function (a) { return !0; }"),
        (
            r#"function (a) { return a == "object"; }"#,
            r#"function (a) { return a === "object"; }"#,
        ),
        (
            "function (a, b) { return typeof a == b; }",
            "function (a, b) { return typeof a === b; }",
        ),
    ];
    for (one, other) in pairs {
        assert!(tree_of(one) != tree_of(other), "{one} | {other}");
    }
}

#[test]
fn what_another_printer_makes_of_a_helper_is_recognized() {
    let printed_again = replace_each(
        CREATE_BINDING,
        &[
            (
                "if (k2 === undefined) k2 = k;",
                "if (k2 === void 0) {\n      k2 = k;\n    }",
            ),
            (
                "{\n      desc = { enumerable: true, get: function() { return m[k]; } };\n    }",
                "desc = { enumerable: !0, get: function() { return m[k]; } };",
            ),
        ],
    );
    let both = [
        Shape::CreateBindingReusesDescriptor,
        Shape::CreateBindingCopiesValue,
    ];
    assert_eq!(shapes_in("/a.cjs", &printed_again), both);
    let printed_again = replace_each(
        ESBUILD_MODULE_HELPERS,
        &[
            ("=== \"", "== \""),
            ("\"function\") {", "\"function\")"),
            ("  }\n  return to;", "  return to;"),
            ("true", "!0"),
            (
                "(mod) => __copyProps(__defProp({}, \"__esModule\", { value: !0 }), mod);",
                "(mod) => {\n  return __copyProps(__defProp({}, \"__esModule\", { value: !0 }), mod);\n};",
            ),
        ],
    );
    assert_eq!(shapes_in("/a.cjs", &printed_again), ESBUILD_MODULE_SHAPES);
}

#[test]
fn helpers_of_esbuild_are_recognized() {
    assert_eq!(
        shapes_in("/a.cjs", ESBUILD_MODULE_HELPERS),
        ESBUILD_MODULE_SHAPES
    );
    assert_eq!(
        shapes_in("/a.mjs", &format!("{ESBUILD_MODULE_HELPERS}export {{}};")),
        ESBUILD_MODULE_SHAPES
    );
    let shortened =
        "var a=Object.defineProperty,b=(c,d)=>{for(var e in d)a(c,e,{get:d[e],enumerable:!0})};";
    assert_eq!(
        shapes_in("/a.cjs", shortened),
        [Shape::ExportDefinesGetters]
    );
}

const ESBUILD_IMPORT_HELPERS: &str = r#"var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
"#;

const ESBUILD_IMPORT_SHAPES: [Shape; 3] = [
    Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
    Shape::ReExportCopiesAllButDefault,
    Shape::ToEsModuleShowsUnmarkedValueAsDefault,
];

const ESBUILD_SHORTENED_SYNTAX: &str = r#"var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf, __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: !0 });
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: !0 }) : target,
  mod
)), __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: !0 }), mod);
"#;

const ROLLDOWN_IMPORT_HELPERS: &str = r#"var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
"#;

#[test]
fn the_helpers_that_bundlers_write_around_a_require_are_recognized() {
    assert_eq!(
        shapes_in("/a.cjs", ESBUILD_IMPORT_HELPERS),
        ESBUILD_IMPORT_SHAPES
    );
    assert_eq!(
        shapes_in("/a.cjs", ESBUILD_SHORTENED_SYNTAX),
        [
            Shape::ExportDefinesGetters,
            Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
            Shape::ToEsModuleShowsUnmarkedValueAsDefault,
            Shape::ToCommonJsCopiesOntoNewMarkedObject,
        ]
    );
    assert_eq!(
        shapes_in("/a.cjs", ROLLDOWN_IMPORT_HELPERS),
        [
            Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks,
            Shape::ToEsModuleShowsValueWithoutDefaultAsDefault,
        ]
    );
    let renamed = replace_each(
        ESBUILD_IMPORT_HELPERS,
        &[("key", "key2"), ("except", "except2"), ("mod", "mod2")],
    );
    assert_eq!(shapes_in("/a.cjs", &renamed), ESBUILD_IMPORT_SHAPES);
}

#[test]
fn a_helper_around_a_require_that_differs_in_one_place_is_an_ordinary_function() {
    let copy = Shape::CopyPropertiesDefinesGettersForOwnNamesTheTargetLacks;
    let re_export = Shape::ReExportCopiesAllButDefault;
    let to_es_module = Shape::ToEsModuleShowsUnmarkedValueAsDefault;
    // What calls the copying helper goes with it.
    for (from, to) in [
        ("from && typeof", "from || typeof"),
        ("=== \"object\"", "=== \"symbol\""),
        (
            "let key of __getOwnPropNames(from)",
            "let key in __getOwnPropNames(from)",
        ),
        (
            "let key of __getOwnPropNames(from)",
            "let key of __getOwnPropNames(to)",
        ),
        ("!__hasOwnProp.call(to, key)", "__hasOwnProp.call(to, key)"),
        ("__hasOwnProp.call(to, key)", "__hasOwnProp.apply(to, key)"),
        ("key !== except", "key === except"),
        ("__defProp(to, key, {", "__defProp(from, key, {"),
        ("get: () => from[key]", "get: () => from.key"),
        ("get: () => from[key]", "set: () => from[key]"),
        (
            "get: () => from[key]",
            "get: function () { return from[key]; }",
        ),
        ("enumerable: !(desc", "enumerable: (desc"),
        ("__getOwnPropDesc(from, key)", "__getOwnPropDesc(to, key)"),
        ("desc.enumerable }", "desc.configurable }"),
        ("return to;", "return from;"),
    ] {
        let changed = replace_each(ESBUILD_IMPORT_HELPERS, &[(from, to)]);
        assert_eq!(shapes_in("/a.cjs", &changed), [], "{to}");
    }
    for (from, to) in [
        (
            "(__copyProps(target, mod, \"default\")",
            "(__copyProps(target, mod, \"Default\")",
        ),
        (
            "(__copyProps(target, mod, \"default\")",
            "(__copyProps(mod, target, \"default\")",
        ),
        ("secondTarget && __copyProps", "secondTarget || __copyProps"),
        (
            "__copyProps(secondTarget, mod, \"default\")",
            "__copyProps(secondTarget, mod)",
        ),
    ] {
        let changed = replace_each(ESBUILD_IMPORT_HELPERS, &[(from, to)]);
        assert_eq!(shapes_in("/a.cjs", &changed), [copy, to_es_module], "{to}");
    }
    for (from, to) in [
        ("mod != null", "mod !== null"),
        ("__create(__getProtoOf(mod))", "__create(mod)"),
        (
            "__create(__getProtoOf(mod)) : {}",
            "__create(__getProtoOf(mod)) : []",
        ),
        ("isNodeMode || !mod", "isNodeMode && !mod"),
        ("!mod.__esModule", "mod.__esModule"),
        ("!mod.__esModule", "!mod.__esmodule"),
        ("\"default\", { value: mod", "\"Default\", { value: mod"),
        ("{ value: mod, enumerable: true }", "{ value: mod }"),
        (
            "{ value: mod, enumerable: true }",
            "{ value: target, enumerable: true }",
        ),
        (
            "{ value: mod, enumerable: true }",
            "{ value: mod, enumerable: true, writable: true }",
        ),
        (": target,\n  mod\n", ": target,\n  target\n"),
        (
            "var __getProtoOf = Object.getPrototypeOf;",
            "var __getProtoOf = Object.create;",
        ),
        (
            "var __create = Object.create;",
            "var __create = Object.assign;",
        ),
    ] {
        let changed = replace_each(ESBUILD_IMPORT_HELPERS, &[(from, to)]);
        assert_eq!(shapes_in("/a.cjs", &changed), [copy, re_export], "{to}");
    }
    for (from, to) in [
        ("i = 0, n", "i = 1, n"),
        ("i < n", "i <= n"),
        ("key = keys[i]", "key = keys[n]"),
        (".bind(null, key)", ".bind(null, i)"),
        ("((k) => from[k])", "((k) => to[k])"),
    ] {
        let changed = replace_each(ROLLDOWN_IMPORT_HELPERS, &[(from, to)]);
        assert_eq!(shapes_in("/a.cjs", &changed), [], "{to}");
    }
    let changed = replace_each(
        ROLLDOWN_IMPORT_HELPERS,
        &[("call(mod, \"default\")", "call(mod, \"Default\")")],
    );
    assert_eq!(shapes_in("/a.cjs", &changed), [copy]);
    let changed = replace_each(
        ESBUILD_SHORTENED_SYNTAX,
        &[("key !== except && __defProp", "key !== except || __defProp")],
    );
    assert_eq!(shapes_in("/a.cjs", &changed), [Shape::ExportDefinesGetters]);
}

const SET_MODULE_DEFAULT: &str = r#"var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
"#;

const IMPORT_STAR: &str = r#"var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
"#;

const IMPORT_STAR_OVER_OWN_NAMES: &str = r#"var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
"#;

const IMPORT_DEFAULT: &str = r#"var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
"#;

#[test]
fn the_helpers_that_typescript_writes_around_a_require_are_recognized() {
    let below = [
        Shape::CreateBindingReusesDescriptor,
        Shape::CreateBindingCopiesValue,
        Shape::SetModuleDefaultDefinesValue,
        Shape::SetModuleDefaultStoresValue,
    ];
    for (star, shape) in [
        (
            IMPORT_STAR,
            Shape::ImportStarAnswersMarkedValueOrBindsItsEnumerableNames,
        ),
        (
            IMPORT_STAR_OVER_OWN_NAMES,
            Shape::ImportStarAnswersMarkedValueOrBindsItsOwnNames,
        ),
    ] {
        let source = format!("{CREATE_BINDING}{SET_MODULE_DEFAULT}{star}{IMPORT_DEFAULT}");
        let mut expected = below.to_vec();
        expected.extend([shape, Shape::ImportDefaultAnswersMarkedValueOrWrapsIt]);
        assert_eq!(shapes_in("/a.cjs", &source), expected);
        assert!(holds_in("/a.cjs", &source).iter().all(|&holds| holds));
    }
}

#[test]
fn a_helper_of_typescript_around_a_require_that_differs_in_one_place_is_an_ordinary_function() {
    let shapes_with = |star: &str, default: &str| {
        let source = format!("{CREATE_BINDING}{SET_MODULE_DEFAULT}{star}{default}");
        let mut shapes = shapes_in("/a.cjs", &source);
        shapes.retain(|shape| matches!(shape.helper(), Helper::ImportStar | Helper::ImportDefault));
        shapes
    };
    let default = Shape::ImportDefaultAnswersMarkedValueOrWrapsIt;
    for (from, to) in [
        ("mod && mod.__esModule", "mod || mod.__esModule"),
        ("mod.__esModule) return mod", "mod.__esmodule) return mod"),
        ("return mod;", "return result;"),
        ("var result = {};", "var result = [];"),
        ("mod != null", "mod !== null"),
        ("k !== \"default\"", "k !== \"Default\""),
        (
            "hasOwnProperty.call(mod, k)",
            "hasOwnProperty.call(result, k)",
        ),
        (
            "__createBinding(result, mod, k)",
            "__createBinding(mod, result, k)",
        ),
        (
            "__setModuleDefault(result, mod)",
            "__setModuleDefault(mod, result)",
        ),
        ("return result;", "return mod;"),
    ] {
        let changed = replace_each(IMPORT_STAR, &[(from, to)]);
        assert_eq!(shapes_with(&changed, IMPORT_DEFAULT), [default], "{to}");
    }
    for (from, to) in [
        ("Object.getOwnPropertyNames ||", "Object.keys ||"),
        ("return ownKeys(o);", "return ownKeys(o).reverse();"),
        ("i = 0; i < k.length", "i = 1; i < k.length"),
        ("k[i] !== \"default\"", "k[i] === \"default\""),
        (
            "__createBinding(result, mod, k[i])",
            "__createBinding(result, mod, k[0])",
        ),
    ] {
        let changed = replace_each(IMPORT_STAR_OVER_OWN_NAMES, &[(from, to)]);
        assert_eq!(shapes_with(&changed, IMPORT_DEFAULT), [default], "{to}");
    }
    let star = Shape::ImportStarAnswersMarkedValueOrBindsItsEnumerableNames;
    for (from, to) in [
        ("mod && mod.__esModule", "mod.__esModule"),
        ("? mod : {", "? {} : {"),
        ("{ \"default\": mod }", "{ \"default\": mod, a: 1 }"),
        ("{ \"default\": mod }", "{ \"Default\": mod }"),
    ] {
        let changed = replace_each(IMPORT_DEFAULT, &[(from, to)]);
        assert_eq!(shapes_with(IMPORT_STAR, &changed), [star], "{to}");
    }
    let other_default = SET_MODULE_DEFAULT.replace("enumerable: true, value: v", "value: v");
    let source = format!("{CREATE_BINDING}{other_default}{IMPORT_STAR}");
    let shapes = shapes_in("/a.cjs", &source);
    assert!(!shapes.contains(&star), "{shapes:?}");
}

#[test]
fn helpers_of_bun_are_recognized() {
    let source = r#"var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};
"#;
    assert_eq!(
        shapes_in("/a.mjs", source),
        [
            Shape::ReturnValueReturnsArgument,
            Shape::ExportSetterStoresBoundReturnValue,
            Shape::ExportDefinesGettersAndBoundSetters,
        ]
    );
}

#[test]
fn a_variable_that_is_no_alias_of_the_global_makes_an_ordinary_function() {
    let changes = [
        (
            "var __defProp = Object.defineProperty;",
            "var __defProp = Reflect.defineProperty;",
        ),
        (
            "var __defProp = Object.defineProperty;",
            "var __defProp = Object.defineProperties;",
        ),
        (
            "var __defProp = Object.defineProperty;",
            "var __defProp = Object.defineProperty; __defProp = null;",
        ),
        (
            "var __defProp = Object.defineProperty;",
            "var Object = {}; var __defProp = Object.defineProperty;",
        ),
        (
            "var __defProp = Object.defineProperty;",
            "var __defProp = (o, k, d) => Object.defineProperty(o, k, d);",
        ),
    ];
    for (from, to) in changes {
        let changed = replace_each(ESBUILD_MODULE_HELPERS, &[(from, to)]);
        assert_eq!(shapes_in("/a.cjs", &changed), [], "{to}");
    }
    let other = (
        "var __getOwnPropDesc = Object.getOwnPropertyDescriptor;",
        "var __getOwnPropDesc = Object.getOwnPropertyNames;",
    );
    let changed = replace_each(ESBUILD_MODULE_HELPERS, &[other]);
    assert_eq!(shapes_in("/a.cjs", &changed), [Shape::ExportDefinesGetters]);
}

#[test]
fn a_branch_that_a_locked_built_in_rules_out_is_no_alternative() {
    let count_held = |source: &str| bindings_in("/a.cjs", source, |values| values.functions.len());
    assert_eq!(count_held(CREATE_BINDING), [1]);
    let asks_something_else = CREATE_BINDING.replace("Object.create ?", "globalThis.flag ?");
    assert_eq!(count_held(&asks_something_else), [2]);
}

#[test]
fn a_definition_in_the_head_holds_from_the_start() {
    let wrapper = "var __returnValue = (v) => v;\n";
    assert_eq!(
        holds_in("/a.mjs", &format!("{wrapper}export {{}};")),
        [true]
    );
    let behind_reads = format!(
        "var names = Object.getOwnPropertyNames;\nvar load = import.meta.require;\n{wrapper}export {{}};"
    );
    assert_eq!(holds_in("/a.mjs", &behind_reads), [true]);
    let behind_a_call = format!("globalThis.start();\n{wrapper}export {{}};");
    assert_eq!(holds_in("/a.mjs", &behind_a_call), [false]);
    let in_a_function =
        format!("function outer() {{ {wrapper} return __returnValue; }}\nexport {{}};");
    assert_eq!(holds_in("/a.mjs", &in_a_function), [false]);
}

#[test]
fn a_definition_behind_other_code_of_its_statement_does_not_hold_from_the_start() {
    let holds = |source: &str| holds_in("/a.mjs", &format!("{source}\nexport {{}};"));
    let wrapper = "(v) => v";
    let in_front =
        format!("var keys = Object.keys, __returnValue = {wrapper}, started = globalThis.start();");
    assert_eq!(holds(&in_front), [true]);
    assert_eq!(
        holds(&format!(
            "var started = globalThis.start(), __returnValue = {wrapper};"
        )),
        [false]
    );
    assert_eq!(
        holds(&format!(
            "var __returnValue = (globalThis.start(), {wrapper});"
        )),
        [false]
    );
    assert_eq!(
        holds(&format!("var __returnValue;\n__returnValue = {wrapper};")),
        [true]
    );
    assert_eq!(
        holds(&format!(
            "var __returnValue;\n__returnValue = (globalThis.start(), {wrapper});"
        )),
        [false]
    );
}

#[test]
fn exports_that_the_statement_has_handed_out_are_not_untouched() {
    let certainty = |source: &str| certainties_in("/a.cjs", source);
    let helper = "__createBinding = (this && this.__createBinding) || function (o, m, k, k2) {\n    if (k2 === undefined) k2 = k;\n    o[k2] = m[k];\n}";
    assert_eq!(
        certainty(&format!("var {helper};")),
        [Certainty::OnceInitialized]
    );
    let behind_a_call = format!("var touched = globalThis.touch(this), {helper};");
    assert_eq!(certainty(&behind_a_call), [Certainty::MayHoldOtherValues]);
}

const TSLIB_ES_MODULE: &str = r#"export var __createBinding = Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
});

export function __exportStar(m, o) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(o, p)) __createBinding(o, m, p);
}
"#;

const MAIN_THAT_IMPORTS_EXPORT_STAR: &str =
    "import { __exportStar } from \"./tslib.mjs\";\n__exportStar({ a: 1 }, {});";

fn with_callee_of_last_call<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&ResolveInput<'_, '_>, KnownCallee) -> R,
) -> R {
    with_graph(files, |graph, bind_input| {
        let helpers = KnownHelpers::compute(bind_input.files, &run_serially);
        let input = ResolveInput {
            files: bind_input.files,
            modules: graph,
            helpers: &helpers,
        };
        let file = file_named(bind_input, files[0].0);
        let hir = input.files.hir(file);
        let last = hir.ids(hir.body).last().expect("the file has a statement");
        let StmtKind::Expr(call) = hir[last].kind else {
            panic!("the last statement of the first file is a call");
        };
        let ExprKind::Call(site) = hir[call].kind else {
            panic!("the last statement of the first file is a call");
        };
        let callee = resolve_callee(&input, file, hir[site].callee);
        then(&input, callee.expect("the callee is a known helper"))
    })
}

fn last_call_needs_guard(files: &[(&str, &str)]) -> bool {
    with_callee_of_last_call(files, |_, callee| callee.needs_guard())
}

#[test]
fn resolves_imported_function_declaration() {
    let named = "import { __exportStar as star } from \"./tslib.mjs\";\nstar({ a: 1 }, {});";
    let namespace = "import * as tslib from \"./tslib.mjs\";\ntslib.__exportStar({ a: 1 }, {});";
    for main in [named, namespace] {
        let files = [("main.mjs", main), ("tslib.mjs", TSLIB_ES_MODULE)];
        with_callee_of_last_call(&files, |input, callee| {
            let helper = callee.helper(input.helpers);
            assert_eq!(helper, Some(Helper::ExportStar), "{main}");
            assert_eq!(callee.certainty, Certainty::Always, "{main}");
            let path = input.files.module(callee.file).file_name();
            assert!(path.ends_with(b"/tslib.mjs"), "{main}");
        });
    }
}

#[test]
fn a_variable_of_another_file_may_still_be_empty() {
    let variable = replace_each(
        TSLIB_ES_MODULE,
        &[
            (
                "export function __exportStar(m, o)",
                "export var __exportStar = function(m, o)",
            ),
            (
                "__createBinding(o, m, p);\n}",
                "__createBinding(o, m, p);\n};",
            ),
        ],
    );
    let files = [
        ("main.mjs", MAIN_THAT_IMPORTS_EXPORT_STAR),
        ("tslib.mjs", variable.as_str()),
    ];
    with_callee_of_last_call(&files, |input, callee| {
        let found = input.helpers.file(callee.file);
        let mut bindings = found.expect("the file has helpers").bindings();
        let at_home = bindings.find(|(_, values)| values.functions == callee.functions);
        let (_, at_home) = at_home.expect("a variable of the file holds the helper");
        assert_eq!(at_home.certainty, Certainty::OnceInitialized);
        assert!(at_home.holds_from_the_start);
        assert_eq!(callee.certainty, Certainty::OnceInitialized);
        assert!(!callee.holds_from_the_start);
        assert!(callee.needs_guard());
    });
    let declaration = [
        ("main.mjs", MAIN_THAT_IMPORTS_EXPORT_STAR),
        ("tslib.mjs", TSLIB_ES_MODULE),
    ];
    assert!(!last_call_needs_guard(&declaration));
    let own = replace_each(&variable, &[("export var", "var")]);
    let own = format!("{own}__exportStar({{ a: 1 }}, {{}});");
    assert!(!last_call_needs_guard(&[("main.mjs", own.as_str())]));
}

#[test]
fn a_declaration_that_another_file_may_call_early_guards_the_variable_that_it_names() {
    let variable_needs_guard = |tslib: &str| {
        let files = [
            ("main.mjs", MAIN_THAT_IMPORTS_EXPORT_STAR),
            ("tslib.mjs", tslib),
        ];
        with_callee_of_last_call(&files, |input, callee| {
            assert!(!callee.needs_guard());
            let [held] = callee.functions[..] else {
                panic!("the binding holds one function");
            };
            let known = input.helpers.function(callee.file, held.definition);
            let [named] = known.expect("the function is a helper").references[..] else {
                panic!("the helper names one helper");
            };
            let accepts = |shape: Shape| shape.helper() == Helper::CreateBinding;
            let resolved = resolve_reference(input, callee.file, named, &accepts);
            resolved.expect("the variable holds the helper").needs_guard
        })
    };
    assert!(!variable_needs_guard(TSLIB_ES_MODULE));
    let on_a_cycle = format!("import \"./main.mjs\";\n{TSLIB_ES_MODULE}");
    assert!(variable_needs_guard(&on_a_cycle));
}

const REQUIRE_OF_ESBUILD: &str = r#"var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
"#;

#[test]
fn the_require_of_an_es_module_is_the_require_of_the_published_text() {
    assert_eq!(
        shapes_in("/a.mjs", &format!("{REQUIRE_OF_ESBUILD}export {{}};")),
        [Shape::RequireFactoryPrefersRequire]
    );
}

#[test]
fn a_definition_behind_the_call_that_makes_the_require_of_esbuild_holds_from_the_start() {
    let wrapper = "var __returnValue = (v) => v;\nexport {};";
    assert_eq!(
        holds_in("/a.mjs", &format!("{REQUIRE_OF_ESBUILD}{wrapper}")),
        [true]
    );
    let gets_another_function = REQUIRE_OF_ESBUILD.replace(
        ": x)(function(x) {",
        ": x)(globalThis.start() || function(x) {",
    );
    assert_ne!(gets_another_function, REQUIRE_OF_ESBUILD);
    assert_eq!(
        holds_in("/a.mjs", &format!("{gets_another_function}{wrapper}")),
        [false]
    );
}
