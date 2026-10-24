use super::Reference;
use super::canonical::{CanonicalInput, canonical_function};
use super::find::{
    BindingValues, Certainty, FileHelpers, FindInput, KnownReference, find, find_global,
};
use super::published::{Helper, PUBLISHED_FUNCTIONS, Shape};
use super::table::{Table, analyze, find_published_function};

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

const ESBUILD_MODULE_SHAPES: [Shape; 1] = [Shape::ExportDefinesGetters];

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
fn a_global_that_is_shadowed_is_no_global() {
    let source = format!("function outer(Object) {{ {CREATE_BINDING} return __createBinding; }}");
    assert_eq!(
        shapes_in("/a.cjs", &source),
        [Shape::CreateBindingCopiesValue]
    );
    let source = format!("var undefined = 1; {CREATE_BINDING}");
    assert_eq!(shapes_in("/a.mjs", &source), []);
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

#[test]
fn the_require_of_an_es_module_is_the_require_of_the_published_text() {
    let source = r#"var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
export {};
"#;
    assert_eq!(
        shapes_in("/a.mjs", source),
        [Shape::RequireFactoryPrefersRequire]
    );
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
