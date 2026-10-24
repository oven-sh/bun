use super::CommonJsExports;
use crate::modules::plan::{Member, Shape};
use crate::modules::testing::{file_named, with_graph};
use crate::modules::{BindInput, ModuleRef};
use bun_sema::atom::Atom;

fn with_exports<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&CommonJsExports, &BindInput<'_, '_>) -> R,
) -> R {
    with_graph(files, |graph, input| then(graph.commonjs(), input))
}

fn module_named(input: &BindInput<'_, '_>, name: &str) -> ModuleRef {
    ModuleRef::File(file_named(input, name))
}

fn atom(input: &BindInput<'_, '_>, name: &str) -> Atom {
    input.files.atoms.intern(name.as_bytes())
}

// What is said of `module.cjs` and of the name `a` where `main.cjs` is the entry point.
fn ask<R>(
    main: &str,
    module: &str,
    question: impl FnOnce(&CommonJsExports, ModuleRef, Atom) -> R,
) -> R {
    let files = [("main.cjs", main), ("module.cjs", module)];
    with_exports(&files, |exports, input| {
        question(exports, module_named(input, "module.cjs"), atom(input, "a"))
    })
}

fn shape_with(main: &str, module: &str) -> Shape {
    ask(main, module, |exports, module, _| exports.shape(module))
}

fn is_settled(main: &str, module: &str) -> bool {
    ask(main, module, CommonJsExports::settled)
}

fn shapes_of<const N: usize>(files: &[(&str, &str)], names: [&str; N]) -> [Shape; N] {
    with_exports(files, |exports, input| {
        names.map(|name| exports.shape(module_named(input, name)))
    })
}

// The shapes of `module.cjs` and of the `inner.cjs` beside it.
fn shapes_beside(module: &str, inner: &str) -> [Shape; 2] {
    let files = [
        ("main.cjs", READS_A),
        ("module.cjs", module),
        ("inner.cjs", inner),
    ];
    shapes_of(&files, ["module.cjs", "inner.cjs"])
}

const READS_A: &str = "const m = require('./module.cjs'); console.log(m.a);";

#[test]
fn stores_under_constant_names_need_no_object() {
    for module in [
        "exports.a = 1;",
        "module.exports.a = 1; this.b = 2; exports['c'] = 3;",
        "exports.b = exports.a = void 0; exports.a = 1;",
        "function later() { exports.z = 1; } exports.a = later;",
        "if (Math.random()) exports.a = 1;",
        "exports.a = 1; exports.a++; exports.a += 2;",
        "var utils = exports; utils.a = 1;",
        "exports.a = 1; if (exports) exports.b = exports.a; var c = exports && 1; var d = !exports;",
        "exports.a = function () { return exports.a; };",
    ] {
        assert_eq!(shape_with(READS_A, module), Shape::Names, "{module}");
    }
}

#[test]
fn text_as_typescript_emits_it() {
    let module = r#""use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Thing = exports.a = void 0;
exports.add = add;
function add(x, y) { return x + y; }
exports.a = 1;
class Thing {}
exports.Thing = Thing;
"#;
    let main = "const module_1 = require('./module.cjs'); console.log((0, module_1.add)(module_1.a, 1), new module_1.Thing());";
    let files = [("main.cjs", main), ("module.cjs", module)];
    with_exports(&files, |exports, input| {
        let module = module_named(input, "module.cjs");
        assert_eq!(exports.shape(module), Shape::Names);
        assert_eq!(exports.marker(module), Some(true));
        for name in ["add", "a", "Thing"] {
            assert!(exports.settled(module, atom(input, name)), "{name}");
            assert!(exports.ignores_this(module, atom(input, name)), "{name}");
            let member = exports.member_named(module, atom(input, name));
            assert!(
                matches!(member, Some(Member::Variable(_))),
                "{name}: {member:?}"
            );
        }
        // Nobody reads it.
        assert_eq!(exports.member_named(module, atom(input, "other")), None);
        assert_eq!(
            exports.member_named(module, atom(input, "__esModule")),
            Some(Member::Marker(true))
        );
    });
}

// A run of the body may end without the name, so an ES module that imports it has to ask.
#[test]
fn the_default_of_an_assignment_pattern_stores_on_some_runs() {
    for module in [
        "let x; [x = (exports.a = 1)] = [5];",
        "let x; ({ x = (exports.a = 1) } = { x: 5 });",
        "let x; ({ y: x = (exports.a = 1) } = { y: 5 });",
        "let x; ({ y: [x = (exports.a = 1)] } = { y: [5] });",
    ] {
        assert!(!is_settled(READS_A, module), "{module}");
    }
    for module in [
        "let x; x = exports.a = 1;",
        "let x; [x] = [exports.a = 1];",
        "let x; ({ x } = { x: exports.a = 1 });",
        "[exports.a = 1] = [5];",
    ] {
        assert!(is_settled(READS_A, module), "{module}");
    }
}

// Whoever holds the function calls it again behind the end of the body, and an ES importer holds what the name had at the link.
#[test]
fn a_function_that_is_called_where_it_is_written_may_be_called_again() {
    for module in [
        "(function again() { exports.a = Math.random(); exports.f = again; })();",
        "(function again() { exports.a = Math.random(); exports.f = () => again(); })();",
        "(function () { exports.a = Math.random(); exports.f = arguments.callee; })();",
    ] {
        assert!(!is_settled(READS_A, module), "{module}");
    }
    for module in [
        "(function () { exports.a = Math.random(); })();",
        "(function named() { exports.a = Math.random(); })();",
        "(() => { exports.a = Math.random(); })();",
    ] {
        assert!(is_settled(READS_A, module), "{module}");
    }
}

// The function around a default of a pattern, the test of a `case`, a computed name and what a class extends is known.
#[test]
fn a_this_of_a_function_is_no_mention_of_the_exports_wherever_it_stands() {
    for module in [
        "exports.a = 1; class C { m(o) { const { t = this.t } = o; return t; } } exports.C = C;",
        "exports.a = 1; class C { m(o) { const [t = this.t] = o; return t; } } exports.C = C;",
        "exports.a = 1; class C { m(o) { const { [this.k]: t } = o; return t; } } exports.C = C;",
        "exports.a = 1; class C { m({ t = this.t }) { return t; } } exports.C = C;",
        "exports.a = 1; class C { m(k) { switch (k) { case this.t: return 1; } } } exports.C = C;",
        "exports.a = 1; exports.f = function () { return class extends this.Base {}; };",
        "exports.a = 1; exports.f = function () { return class { [this.k]() {} }; };",
        "exports.a = 1; const { b = this.a } = {};",
        "exports.a = 1; switch (1) { case this.a: }",
    ] {
        assert_eq!(shape_with(READS_A, module), Shape::Names, "{module}");
    }
    // At the top it is the object.
    for module in [
        "exports.a = 1; const { b = this } = {};",
        "exports.a = 1; switch (1) { case this: }",
        "exports.a = 1; class C extends this {}",
    ] {
        assert_eq!(shape_with(READS_A, module), Shape::Value, "{module}");
    }
}

#[test]
fn a_function_without_this_ignores_it_beside_one_that_reads_it_in_a_default() {
    let module = "exports.a = function () { return 1; }; exports.b = function (o) { const { t = this.t } = o; return t; };";
    let files = [("main.cjs", READS_A), ("module.cjs", module)];
    with_exports(&files, |exports, input| {
        let module = module_named(input, "module.cjs");
        assert!(exports.ignores_this(module, atom(input, "a")));
        assert!(!exports.ignores_this(module, atom(input, "b")));
    });
}

// Whoever the call runs finds the module without the marker.
#[test]
fn a_call_in_front_of_the_marker_counts_wherever_it_stands() {
    let main = "exports.look = () => require('./module.cjs').__esModule; require('./module.cjs');";
    for module in [
        "switch (1) { case require('./main.cjs').look(): } exports.__esModule = true;",
        "const { b = require('./main.cjs').look() } = {}; exports.__esModule = true;",
        "const [b = require('./main.cjs').look()] = []; exports.__esModule = true;",
    ] {
        let marker = ask(main, module, |exports, module, _| exports.marker(module));
        assert_eq!(marker, None, "{module}");
    }
}

// `export = e` of TypeScript is the statement `module.exports = e`.
#[test]
fn export_equals_of_a_literal_needs_no_object() {
    let shape_of = |module: &str| {
        let main = "import m = require('./module'); console.log(m.a);";
        shapes_of(&[("main.ts", main), ("module.ts", module)], ["module.ts"])[0]
    };
    for module in [
        "export = { a: 1, list: [1, 2] };",
        "function a() {} export = { a, b: a };",
        "export = { a: 1 } as { a: number };",
    ] {
        assert_eq!(shape_of(module), Shape::Names, "{module}");
    }
    for module in [
        "export = { a: 1, ...Math };",
        "export = { a: 1, f() { return this.a; } };",
        "const table = { a: 1 }; export = table;",
    ] {
        assert_eq!(shape_of(module), Shape::Value, "{module}");
    }
}

#[test]
fn the_module_looks_at_its_own_object() {
    for module in [
        "exports.a = 1; console.log(exports);",
        "exports.a = 1; module.exports = { a: 2 };",
        "module.exports = { a: 2 }; exports.a = 1;",
        "module.exports = { a: 2 }; this.a = 1;",
        "module.exports = { a: 2 }; module.exports = { a: 3 };",
        "module.exports = { a: 2, ...Math };",
        "module.exports = { a: 2, [Math.random()]: 1 };",
        "module.exports = { get a() { return 2; } };",
        "module.exports = { a: 2, toString() {} };",
        "if (Math.random()) module.exports = { a: 2 };",
        "console.log(module.exports = { a: 2 });",
        "exports = module.exports = { a: 2 };",
        "function set() { module.exports.a = 1; } set(); module.exports = { a: 2 };",
        "exports.a = 1; exports = {};",
        "exports.a = 1; exports[Math.random()] = 2;",
        "exports.a = 1; delete exports.a;",
        "exports.a = 1; exports.toString = 2;",
        "exports.a = 1; exports[0] = 2;",
        "exports.a = 1; exports.__proto__ = null;",
        "exports.a = 1; for (const key in exports) console.log(key);",
        "exports.a = 1; console.log(module);",
        "exports.a = 1; eval('exports');",
        "exports.a = 1; console.log(arguments);",
        "exports.a = 1; var b = exports || 1;",
        "exports.a = 1; Object.defineProperty(exports, 'b', { get() { return Math.random(); } });",
        "exports.a = 1; Object.defineProperty(exports, 'b', { value: 1 }); exports.b = 2;",
        "exports.a = 1; if (Math.random()) Object.defineProperty(exports, 'b', { value: 1 });",
        "module.exports = Math.random();",
    ] {
        assert_eq!(shape_with(READS_A, module), Shape::Value, "{module}");
    }
}

#[test]
fn one_odd_module_takes_no_other_along() {
    let main = "console.log(require('./plain.cjs').a, require('./odd.cjs').a);";
    let files = [
        ("main.cjs", main),
        ("plain.cjs", "exports.a = 1;"),
        ("odd.cjs", "exports.a = 1; console.log(exports);"),
    ];
    assert_eq!(
        shapes_of(&files, ["plain.cjs", "odd.cjs", "main.cjs"]),
        [Shape::Names, Shape::Value, Shape::Value]
    );
}

#[test]
fn the_five_names_and_the_scope() {
    let needs_wrapped_body = |module: &str| {
        ask(READS_A, module, |exports, module, _| {
            exports.needs_wrapped_body(module)
        })
    };
    for module in [
        "exports.a = 1; module = {};",
        "exports.a = 1; require = null;",
        "exports.a = 1; __dirname = '';",
        "exports.a = 1; exports = {};",
        "exports.a = 1; eval('1');",
        "exports.a = 1; console.log(arguments.length);",
    ] {
        assert!(needs_wrapped_body(module), "{module}");
    }
    for module in [
        "exports.a = 1;",
        "exports.a = 1; console.log(exports);",
        "function f() {} exports = module.exports = f; exports.a = 1;",
    ] {
        assert!(!needs_wrapped_body(module), "{module}");
    }
}

#[test]
fn a_literal_takes_the_place_of_the_object() {
    let module = "const b = 1; module.exports = { a: 2, b, c() { return 3; }, 'd': 4 }; module.exports.e = module.exports.a;";
    let main = "const m = require('./module.cjs'); console.log(m.a, m.c());";
    assert_eq!(shape_with(main, module), Shape::Names);
    // A function declaration is called in front of the literal, wherever it is written.
    let stored_early = "set(); module.exports = { a: 2 }; function set() { module.exports.b = 1; }";
    assert_eq!(shape_with(READS_A, stored_early), Shape::Value);
    let read_early =
        "get(); module.exports = { a: 2 }; function get() { return module.exports.a; }";
    assert_eq!(shape_with(READS_A, read_early), Shape::Names);
    // `super` looks above the literal.
    let with_super = "module.exports = { a() { return super.toString(); } };";
    assert_eq!(
        shape_with("const { a } = require('./module.cjs'); a();", with_super),
        Shape::Value
    );
    // Whoever has required the module in a cycle holds the first object.
    let in_cycle = "require('./main.cjs'); module.exports = { a: 2 };";
    assert_eq!(shape_with(READS_A, in_cycle), Shape::Value);
}

#[test]
fn a_module_that_hands_on_another_one() {
    // It holds the object of the other one, like any other value.
    let shapes = shapes_beside("module.exports = require('./inner.cjs');", "exports.a = 1;");
    assert_eq!(shapes, [Shape::Value, Shape::Value]);
}

const BARREL: &str = r#"
var inner_1 = require("./inner.cjs");
exports.a = void 0;
Object.defineProperty(exports, "a", { enumerable: true, get: function () { return inner_1.b; } });
"#;

#[test]
fn a_getter_that_returns_a_name_of_another_module_is_that_name() {
    let files = [
        ("main.cjs", READS_A),
        ("module.cjs", BARREL),
        ("inner.cjs", "exports.b = 1;"),
    ];
    with_exports(&files, |exports, input| {
        let [module, inner] = ["module.cjs", "inner.cjs"].map(|name| module_named(input, name));
        assert_eq!(exports.shape(module), Shape::Names);
        let Some(Member::Variable(id)) = exports.member_named(module, atom(input, "a")) else {
            panic!("the name has no variable");
        };
        assert_eq!(exports.names_by_id[&id].0, inner);
        assert_eq!(exports.dependents(inner), [module]);
    });
}

#[test]
fn a_getter_needs_the_variable_of_the_other_module() {
    for inner in [
        "exports.b = 1; console.log(exports);",
        "module.exports = () => 1;",
    ] {
        assert_eq!(shapes_beside(BARREL, inner)[0], Shape::Value, "{inner}");
    }
}

#[test]
fn a_getter_is_a_name_only_where_its_module_is_loaded_before() {
    for module in [
        // A read in front of the `require` throws.
        "Object.defineProperty(exports, 'a', { get() { return m.b; } }); var m = require('./inner.cjs');",
        // The read evaluates the module.
        "Object.defineProperty(exports, 'a', { get() { return require('./inner.cjs').b; } });",
        "if (Math.random()) var m = require('./inner.cjs'); Object.defineProperty(exports, 'a', { get() { return m.b; } });",
        "var m = require('./inner.cjs'); m = {}; Object.defineProperty(exports, 'a', { get() { return m.b; } });",
        "var m = require('./inner.cjs'); Object.defineProperty(exports, 'a', { get() { return m.b; } }); exports.a = 1;",
    ] {
        let shapes = shapes_beside(module, "exports.b = 1;");
        assert_eq!(shapes[0], Shape::Value, "{module}");
    }
}

#[test]
fn whoever_sees_a_module_half_evaluated_sees_the_definitions_run() {
    let in_cycle = ("inner.cjs", "exports.b = 1; require('./module.cjs');");
    let files = [("main.cjs", READS_A), ("module.cjs", BARREL), in_cycle];
    with_exports(&files, |exports, input| {
        let [module, inner] = ["module.cjs", "inner.cjs"].map(|name| module_named(input, name));
        assert_eq!(exports.shape(module), Shape::Value);
        // Plain stores are seen as they come.
        assert_eq!(exports.shape(inner), Shape::Names);
        assert!(!exports.settled(inner, atom(input, "b")));
    });
}

const SWC_HELPER: &str = r#""use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    a: null,
    b: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
"#;

const SWC_NAMES: &str = r#"_export(exports, {
    a: function() {
        return a;
    },
    b: function() {
        return b;
    }
});
"#;

#[test]
fn text_as_swc_emits_it() {
    let module = format!("{SWC_HELPER}{SWC_NAMES}const a = 1;\nfunction b() {{ return a; }}\n");
    let main = "const _module = require('./module.cjs'); console.log((0, _module.b)(), _module.a);";
    let files = [("main.cjs", main), ("module.cjs", module.as_str())];
    with_exports(&files, |exports, input| {
        let module = module_named(input, "module.cjs");
        assert_eq!(exports.shape(module), Shape::Names);
        assert_eq!(exports.marker(module), Some(true));
        for name in ["a", "b"] {
            let member = exports.member_named(module, atom(input, name));
            assert!(
                matches!(member, Some(Member::Binding(_))),
                "{name}: {member:?}"
            );
        }
    });
}

#[test]
fn the_helper_of_swc_defines_names_only_where_each_getter_returns_one() {
    for names in [
        // The literal is a value.
        "const all = { a: function() { return a; } }; _export(exports, all);",
        // A getter that does more than return.
        "_export(exports, { a: function() { console.log(1); return a; } });",
        // Not a getter: the definition throws.
        "_export(exports, { a: 1 });",
        "_export(exports, { a: function(x) { return a; } });",
        "_export(exports, { ...{}, a: function() { return a; } });",
        "_export(exports, { ['a' + '']: function() { return a; } });",
        "_export(exports, { a: function() { return a; }, a: function() { return b; } });",
        // Some run of the body may pass it by, or come to it twice.
        "if (Math.random()) _export(exports, { a: function() { return a; } });",
        "function later() { _export(exports, { a: function() { return a; } }); } later();",
        "console.log(_export(exports, { a: function() { return a; } }));",
        "_export(exports, { a: function() { return a; } }, 1);",
        // The binding gets another value.
        "_export(exports, { a: function() { return c; } }); let c = 1; c = 2;",
    ] {
        let module = format!("{SWC_HELPER}{names}\nconst a = 1;\nfunction b() {{ return a; }}\n");
        assert_eq!(shape_with(READS_A, &module), Shape::Value, "{names}");
    }
}

#[test]
fn a_function_that_only_looks_like_the_helper_of_swc_gets_the_object() {
    for helper in [
        "function _export(target, all) { for (var name in all) Object.defineProperty(target, name, { enumerable: false, get: all[name] }); }",
        "function _export(target, all) { for (var name in all) Object.defineProperty(target, name, { enumerable: true, configurable: true, get: all[name] }); }",
        "function _export(target, all) { for (var name in all) Object.defineProperty(all, name, { enumerable: true, get: all[name] }); }",
        "function _export(target, all) { for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] }); console.log(target); }",
        "var _export = function (target, all) { for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] }); }; _export = console.log;",
        "function _export(target, all) { for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] }); } _export = console.log;",
        "var Object = { defineProperty: console.log }; function _export(target, all) { for (var name in all) Object.defineProperty(target, name, { enumerable: true, get: all[name] }); }",
    ] {
        let module = format!("{helper}\n{SWC_NAMES}const a = 1;\nfunction b() {{ return a; }}\n");
        assert_eq!(shape_with(READS_A, &module), Shape::Value, "{helper}");
    }
}

#[test]
fn whoever_sees_a_module_half_evaluated_finds_the_getters_that_its_head_defines() {
    let main = "exports.look = () => require('./module.cjs').a; require('./module.cjs');";
    let shape_of = |module: &str| shape_with(main, module);
    let looks = "require('./main.cjs').look();\nconst a = 1;\nfunction b() { return a; }\n";
    for head in [
        format!("{SWC_HELPER}{SWC_NAMES}"),
        "Object.defineProperty(exports, 'a', { enumerable: true, get: function() { return a; } });\n".to_string(),
        "Object.defineProperty(exports, '__esModule', { value: true });\nObject.defineProperty(exports, 'b', { get() { return b; } });\nvar c = function () {}, d = [1, 'x'];\nObject.defineProperty(exports, 'a', { get() { return a; } });\n".to_string(),
    ] {
        assert_eq!(shape_of(&format!("{head}{looks}")), Shape::Names, "{head}");
    }
    for head in [
        "console.log(1);\nObject.defineProperty(exports, 'a', { get() { return a; } });\n",
        "Object.defineProperty(exports, 'b', { get() { return b; } });\nrequire('./main.cjs');\nObject.defineProperty(exports, 'a', { get() { return a; } });\n",
        "Object.defineProperty(exports, 'c', { value: console.log(1) });\nObject.defineProperty(exports, 'a', { get() { return a; } });\n",
        "var c = `${{ toString() { return require('./main.cjs').look(); } }}`;\nObject.defineProperty(exports, 'a', { get() { return a; } });\n",
    ] {
        assert_eq!(shape_of(&format!("{head}{looks}")), Shape::Value, "{head}");
    }
}

#[test]
fn looking_at_a_module_takes_those_along_whose_names_stand_for_its_names() {
    let files = [
        ("main.cjs", READS_A),
        ("module.cjs", BARREL),
        ("inner.cjs", "exports.b = 1;"),
    ];
    with_graph(&files, |_, input| {
        let mut graph = crate::modules::bind_modules(input).graph;
        let [module, inner] = ["module.cjs", "inner.cjs"].map(|name| module_named(input, name));
        graph.look_at(inner);
        assert_eq!(graph.commonjs().shape(inner), Shape::Value);
        assert_eq!(graph.commonjs().shape(module), Shape::Value);
        assert_eq!(
            graph.commonjs().member_named(module, atom(input, "a")),
            Some(Member::OnObject)
        );
    });
}

#[test]
fn a_name_is_settled_where_only_its_own_body_stores_it_in_order() {
    for module in [
        "exports.a = 1;",
        "exports.a = void 0; exports.a = 1;",
        "{ exports.a = 1; }",
        "(function () { exports.a = 1; })();",
        "var b = (exports.a = 1, 2);",
        "if (exports.a = 1) console.log(1);",
        // Every run stores the name, and what a run may skip it skips for good.
        "exports.a = 1; if (Math.random()) exports.a = 2;",
        "exports.a = 1; Math.random() && (exports.a = 2);",
        "exports.a = 1; for (const b of [2, 3]) exports.a = b;",
        "exports.a = 1; try { exports.a = 2; } catch {}",
        "exports.a = 1; exports.a ||= 2;",
        "exports.a = 1; if (Math.random()) return; exports.a = 2;",
        "exports.a = 1; (() => { if (Math.random()) exports.a = 2; })();",
        "exports.a || (exports.a = 1);",
        "exports.a ?? (exports.a = 1);",
        "var b = exports.a || (exports.a = {});",
    ] {
        assert!(is_settled(READS_A, module), "{module}");
    }
    for module in [
        "exports.b = 1;",
        "if (Math.random()) exports.a = 1;",
        "Math.random() && (exports.a = 1);",
        "Math.random() ? exports.a = 1 : 0;",
        "for (;;) { exports.a = 1; break; }",
        "try { exports.a = 1; } catch {}",
        "function set() { exports.a = 1; } set();",
        "exports.a = 1; exports.set = () => { exports.a = 2; };",
        "if (Math.random()) return; exports.a = 1;",
        "console?.log(exports.a = 1);",
        "exports.a &&= 1;",
        "exports.a && (exports.a = 1);",
        "exports.b || (exports.a = 1);",
        "if (Math.random()) exports.a || (exports.a = 1);",
        "exports.a = 1; setTimeout(() => { exports.a = 2; });",
        "exports.a = 1; class C { static set() { exports.a = 2; } } exports.C = C;",
        "exports.a = 1; (async () => { exports.a = 2; })();",
    ] {
        assert!(!is_settled(READS_A, module), "{module}");
    }
    assert!(!is_settled(
        "const m = require('./module.cjs'); m.a = 2;",
        "exports.a = 1;"
    ));
}

#[test]
fn a_call_through_the_object_hands_the_object_over() {
    let ignores_this = |module: &str| ask(READS_A, module, CommonJsExports::ignores_this);
    for module in [
        "exports.a = () => this;",
        "exports.a = function () { return 1; };",
        "function a() {} exports.a = a;",
        "exports.a = class {};",
        "exports.a = 1;",
    ] {
        assert!(ignores_this(module), "{module}");
    }
    for module in [
        "exports.a = function () { return this; };",
        "exports.a = function () { return () => this; };",
        "exports.a = Math.random;",
        "exports.a = () => 1; exports.a = Math.random;",
        "exports.a ??= function () { return this; };",
        "[exports.a = () => 1] = [function () { return this; }];",
    ] {
        assert!(!ignores_this(module), "{module}");
    }
}

#[test]
fn the_marker() {
    let marker = |module: &str| ask(READS_A, module, |exports, module, _| exports.marker(module));
    for (module, expected) in [
        ("exports.a = 1;", Some(false)),
        ("exports.__esModule = true; exports.a = 1;", Some(true)),
        (
            "Object.defineProperty(exports, '__esModule', { value: true });",
            Some(true),
        ),
        ("exports.__esModule = Math.random() < 1;", None),
        ("if (Math.random()) exports.__esModule = true;", None),
        (
            "exports.__esModule = true; exports.__esModule = false;",
            None,
        ),
        ("exports.a = 1; console.log(exports);", None),
        // Whoever finds the module half evaluated in front of the statement finds no marker.
        (
            "Object.defineProperty(exports, '__esModule', { value: true }); require('./main.cjs');",
            Some(true),
        ),
        (
            "require('./main.cjs'); Object.defineProperty(exports, '__esModule', { value: true });",
            None,
        ),
        // A call in a function that is only written in front of it runs later.
        (
            "function f() { g(); } exports.__esModule = true; require('./main.cjs');",
            Some(true),
        ),
    ] {
        assert_eq!(marker(module), expected, "{module}");
    }
    // Code runs without a call too.
    for in_front in [
        "var a = globalThis.peek;",
        "var a = `${globalThis.peek}`;",
        "var a = globalThis.peek + 1;",
        "var [a] = globalThis.peek;",
        "for (var a of globalThis.peek);",
        "switch (1) { case g(): }",
        "var { a = g() } = {};",
    ] {
        let module = format!("{in_front} exports.__esModule = true; require('./main.cjs');");
        assert_eq!(marker(&module), None, "{module}");
    }
    // The helpers that TypeScript writes in front of the marker only make functions.
    for helper in [
        "var __importDefault = (this && this.__importDefault) || function (mod) { return mod; };",
        "var __createBinding = (this && this.__createBinding) || (Object.create ? (function (o) { g(o); }) : (function (o) { g(o); }));",
        "var __extends = (this && this.__extends) || (function () { var e = function (d, b) { g(d, b); }; return function (d, b) { e(d, b); }; })();",
    ] {
        let module = format!(
            "'use strict'; {helper} Object.defineProperty(exports, '__esModule', {{ value: true }}); require('./main.cjs');"
        );
        assert_eq!(marker(&module), Some(true), "{module}");
    }
}

#[test]
fn an_import_of_a_settled_name_is_bound_to_the_variable() {
    let main = "import { one, g } from './k.cjs'; console.log(one, g);";
    let k = "exports.one = 1; exports.g = function (x) { return x; };";
    let files = [("main.mjs", main), ("k.cjs", k)];
    with_exports(&files, |exports, input| {
        let k = module_named(input, "k.cjs");
        assert_eq!(exports.shape(k), Shape::Names);
        assert_eq!(exports.face(k), None);
        assert_eq!(exports.check(file_named(input, "main.mjs")), None);
    });
}

#[test]
fn an_enum_as_typescript_emits_it_is_bound_to_the_variable() {
    let since_3_9 = r#""use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Color = void 0;
var Color;
(function (Color) {
    Color[Color["Red"] = 0] = "Red";
})(Color || (exports.Color = Color = {}));
"#;
    let up_to_3_8 = r#""use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Color;
(function (Color) {
    Color[Color["Red"] = 0] = "Red";
})(Color = exports.Color || (exports.Color = {}));
"#;
    for module in [since_3_9, up_to_3_8] {
        let main = "import { Color } from './k.cjs'; console.log(Color.Red);";
        let files = [("main.mjs", main), ("k.cjs", module)];
        with_exports(&files, |exports, input| {
            let k = module_named(input, "k.cjs");
            assert_eq!(exports.shape(k), Shape::Names, "{module}");
            assert!(exports.settled(k, atom(input, "Color")), "{module}");
            assert_eq!(exports.face(k), None, "{module}");
            assert_eq!(
                exports.check(file_named(input, "main.mjs")),
                None,
                "{module}"
            );
        });
    }
}

#[test]
fn an_import_of_any_other_name_is_a_copy_that_the_face_takes() {
    let main = "import { one, set } from './k.cjs'; console.log(one, set);";
    let k = "exports.one = 1; exports.set = function () { exports.one = 2; };";
    let files = [("main.mjs", main), ("k.cjs", k)];
    with_exports(&files, |exports, input| {
        let file = file_named(input, "k.cjs");
        assert_eq!(
            exports.face(ModuleRef::File(file)),
            Some(ModuleRef::Face(file))
        );
        let [copy] = exports.copies(file) else {
            panic!("{:?}", exports.copies(file));
        };
        assert_eq!(
            exports.names_by_id.get(copy),
            Some(&(ModuleRef::File(file), atom(input, "one")))
        );
        assert_eq!(exports.imported_member(*copy), Member::Copy(*copy));
        assert!(!exports.face_captures(file));
        // The body stores both names whenever it runs to its end.
        assert_eq!(exports.check(file_named(input, "main.mjs")), None);
    });
}

#[test]
fn a_name_that_may_be_absent_is_checked_once_every_file_has_run() {
    let main = "import './first.mjs'; import { late } from './k.cjs'; console.log(late);";
    let first = "import { nope } from './k.cjs'; console.log(nope);";
    let k = "exports.one = 1; if (Math.random()) exports.late = 2;";
    let files = [("main.mjs", main), ("first.mjs", first), ("k.cjs", k)];
    with_exports(&files, |exports, input| {
        let k = module_named(input, "k.cjs");
        let name_of = |entry: &(_, _)| exports.names_by_id.get(&entry.0).map(|owner| owner.1);
        let main: Vec<Option<Atom>> = exports
            .checked_copies(file_named(input, "main.mjs"))
            .iter()
            .map(name_of)
            .collect();
        // A module is linked behind what it imports.
        assert_eq!(main, [Some(atom(input, "nope")), Some(atom(input, "late"))]);
        // No link starts at a file that is only imported by name.
        assert!(
            exports
                .checked_copies(file_named(input, "first.mjs"))
                .is_empty()
        );
        assert!(exports.face(k).is_some());
    });
}
