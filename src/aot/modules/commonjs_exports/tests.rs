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
        "const b = 1; exports.a = 1; Object.defineProperty(exports, 'b', { get() { return b; }, writable: false });",
        "const b = 1; exports.a = 1; Object.defineProperty(exports, 'b', { get() { return b; }, writable: undefined });",
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
fn a_getter_needs_the_variable_of_the_module_behind_es_modules_that_hand_the_name_on() {
    let over_es_module = BARREL.replace("inner.cjs", "between.mjs");
    for (inner, shape) in [
        ("exports.b = 1;", Shape::Names),
        ("exports.b = 1; console.log(exports);", Shape::Value),
        ("if (Math.random()) exports.b = 1;", Shape::Value),
    ] {
        let files = [
            ("main.cjs", READS_A),
            ("module.cjs", &over_es_module[..]),
            ("between.mjs", "export * from './further.mjs';"),
            ("further.mjs", "export { b } from './inner.cjs';"),
            ("inner.cjs", inner),
        ];
        let shapes = shapes_of(&files, ["module.cjs", "inner.cjs"]);
        assert_eq!(shapes, [shape, shape], "{inner}");
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
        "exports.a = () => 1;",
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
        // The arrow function hands the object out.
        "exports.a = () => this;",
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
fn the_face_behind_a_star_takes_the_copy_of_a_name_of_another_file() {
    let outer = "var inner_1 = require('./inner.cjs');\n\
        Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return inner_1.a; } });";
    for main in [
        "import { a } from './barrel.mjs'; console.log(a);",
        "import * as all from './barrel.mjs'; console.log(all.a);",
        "export { a } from './barrel.mjs';",
        "import { a } from './above.mjs'; console.log(a);",
    ] {
        let files = [
            ("main.mjs", main),
            ("above.mjs", "export * from './barrel.mjs';"),
            ("barrel.mjs", "export * from './outer.cjs';"),
            ("outer.cjs", outer),
            ("inner.cjs", "exports.a = 1;"),
        ];
        with_exports(&files, |exports, input| {
            let [outer, inner] = ["outer.cjs", "inner.cjs"].map(|name| file_named(input, name));
            let owners = exports.copies(outer).iter();
            let owners: Vec<_> = owners.map(|copy| exports.names_by_id.get(copy)).collect();
            let owner = (ModuleRef::File(inner), atom(input, "a"));
            assert_eq!(owners, [Some(&owner)], "{main}");
            // The copy is a variable of the face of the file that has the name.
            assert!(exports.face(ModuleRef::File(inner)).is_some(), "{main}");
        });
    }
}

fn getter_of_a(inner: &str) -> String {
    format!(
        "var inner_1 = require('./{inner}');\n\
        Object.defineProperty(exports, 'a', {{ enumerable: true, get: function () {{ return inner_1.a; }} }});"
    )
}

// The names that the face of `outer.cjs` copies, each with the file that has it, where a getter of `outer.cjs` returns `a` of `inner`.
fn copies_of_outer(main: &str, inner: (&str, &str)) -> Vec<(String, bool)> {
    let outer = getter_of_a(inner.0);
    let files = [
        ("main.mjs", main),
        ("barrel.mjs", "export * from './outer.cjs';"),
        ("outer.cjs", &outer[..]),
        inner,
    ];
    with_exports(&files, |exports, input| {
        let outer = file_named(input, "outer.cjs");
        // `export *` looks at the namespace object, which shows the exports object as `default`.
        let shape = match main.contains("barrel") {
            true => Shape::Value,
            false => Shape::Names,
        };
        assert_eq!(exports.shape(ModuleRef::File(outer)), shape, "{main}");
        assert_eq!(exports.check(file_named(input, "main.mjs")), None, "{main}");
        assert_eq!(
            exports.face_captures(outer),
            shape == Shape::Value,
            "{main}"
        );
        let copies = exports.copies(outer).iter().map(|copy| {
            assert_eq!(
                exports.imported_member(*copy),
                Member::Copy(*copy),
                "{main}"
            );
            let (owner, name) = exports.names_by_id[copy];
            let name = String::from_utf8(input.files.atoms.bytes(name).to_vec());
            (
                name.expect("an ASCII name"),
                owner == ModuleRef::File(outer),
            )
        });
        copies.collect()
    })
}

const IMPORTS_OF_A: [&str; 4] = [
    "import { a } from './outer.cjs'; console.log(a);",
    "import * as all from './outer.cjs'; console.log(all.a);",
    "export { a } from './outer.cjs';",
    "import { a } from './barrel.mjs'; console.log(a);",
];

#[test]
fn an_import_holds_what_a_getter_answered_where_the_answer_may_change() {
    let own_copy = [("a".to_owned(), true)];
    for inner in [
        (
            "inner.mjs",
            "export let a = 1; export function set() { a = 2; }",
        ),
        ("inner.mjs", "export var a; a = 1;"),
        // The getter answers `undefined`, where an import of the name from the file itself finds nothing.
        ("inner.cjs", "exports.b = 1;"),
        ("inner.cjs", "if (Math.random()) exports.a = 1;"),
        (
            "inner.cjs",
            "exports.fill = function () { exports.a = 1; };",
        ),
    ] {
        for main in IMPORTS_OF_A {
            assert_eq!(copies_of_outer(main, inner), own_copy, "{main} {inner:?}");
        }
    }
}

#[test]
fn an_import_is_bound_to_what_a_getter_returns_where_nobody_can_tell() {
    for inner in [
        ("inner.mjs", "export const a = 1;"),
        ("inner.mjs", "export let a = 1;"),
        ("inner.mjs", "export function a() {}"),
        ("inner.mjs", "export class a {}"),
        ("inner.cjs", "exports.a = 1;"),
    ] {
        for main in &IMPORTS_OF_A[..3] {
            assert_eq!(copies_of_outer(main, inner), [], "{main} {inner:?}");
        }
    }
}

#[test]
fn whoever_requires_the_file_reads_what_the_getter_returns() {
    let main = "import { a } from './outer.cjs'; import './reader.cjs'; console.log(a);";
    let reader = "var outer = require('./outer.cjs'); console.log(outer.a);";
    for (inner, is_binding) in [
        (
            (
                "inner.mjs",
                "export let a = 1; export function set() { a = 2; }",
            ),
            true,
        ),
        (("inner.cjs", "exports.b = 1;"), false),
    ] {
        let outer = getter_of_a(inner.0);
        let files = [
            ("main.mjs", main),
            ("reader.cjs", reader),
            ("outer.cjs", &outer[..]),
            inner,
        ];
        with_exports(&files, |exports, input| {
            let outer = module_named(input, "outer.cjs");
            let a = atom(input, "a");
            let own = exports.ids[&(outer, a)];
            match exports.member_named(outer, a) {
                Some(Member::Binding(_)) => assert!(is_binding),
                Some(Member::Variable(returned)) => {
                    assert!(!is_binding);
                    let owner = (module_named(input, inner.0), a);
                    assert_eq!(exports.names_by_id.get(&returned), Some(&owner));
                }
                member => panic!("{member:?}"),
            }
            assert_eq!(
                Some(exports.required_member(outer, own)),
                exports.member_named(outer, a)
            );
        });
    }
}

#[test]
fn a_getter_over_an_es_module_that_holds_a_copy_keeps_its_object() {
    let above = "var between_1 = require('./between.mjs');\n\
        Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return between_1.a; } });";
    let outer = getter_of_a("inner.mjs");
    let shape_over = |inner: &str| {
        let files = [
            (
                "main.mjs",
                "import { a } from './above.cjs'; console.log(a);",
            ),
            ("above.cjs", above),
            ("between.mjs", "export { a } from './outer.cjs';"),
            ("outer.cjs", &outer[..]),
            ("inner.mjs", inner),
        ];
        shapes_of(&files, ["above.cjs"])
    };
    assert_eq!(shape_over("export const a = 1;"), [Shape::Names]);
    let stored = "export let a = 1; export function set() { a = 2; }";
    assert_eq!(shape_over(stored), [Shape::Value]);
}

#[test]
fn an_import_holds_what_a_getter_answered_where_the_link_may_find_its_binding_unfilled() {
    let getter = "Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return _a; } });";
    // Whether the face of `outer.cjs`, which is linked while it requires `inner.cjs`, copies `a`.
    let copies_a = |hands_on: &str, rest: &str| {
        let outer = format!("{getter}\n{rest}");
        let files = [
            (
                "main.mjs",
                "import { a } from './hands-on.mjs'; console.log(a);",
            ),
            ("hands-on.mjs", hands_on),
            ("outer.cjs", &outer[..]),
            ("inner.cjs", "require('./hands-on.mjs');"),
        ];
        with_exports(&files, |exports, input| {
            let outer = file_named(input, "outer.cjs");
            let own = (ModuleRef::File(outer), atom(input, "a"));
            let mut copies = exports.copies(outer).iter();
            copies.any(|copy| exports.names_by_id[copy] == own)
        })
    };
    for hands_on in [
        "export { a } from './outer.cjs';",
        "export * from './outer.cjs';",
    ] {
        for rest in [
            "const _a = require('./inner.cjs');",
            "var _a = require('./inner.cjs');",
            "require('./inner.cjs'); let _a = 1;",
            "require('./inner.cjs'); const { _a } = { _a: 1 };",
            "require('./inner.cjs'); class _a {}",
        ] {
            assert!(copies_a(hands_on, rest), "{hands_on} {rest}");
        }
        for rest in [
            "require('./inner.cjs'); function _a() {}",
            "const _a = 1; require('./inner.cjs');",
        ] {
            assert!(!copies_a(hands_on, rest), "{hands_on} {rest}");
        }
    }
}

#[test]
fn the_namespace_object_answers_for_a_getter_that_is_not_enumerable() {
    let hidden = "var inner_1 = require('./inner.cjs');\n\
        Object.defineProperty(exports, 'a', { get: function () { return inner_1.a; } });";
    let listed = getter_of_a("inner.cjs");
    let captures = |main: &str, outer: &str| {
        let files = [
            ("main.mjs", main),
            ("outer.cjs", outer),
            ("inner.cjs", "exports.a = 1;"),
        ];
        with_exports(&files, |exports, input| {
            exports.face_captures(file_named(input, "outer.cjs"))
        })
    };
    let main = "import * as all from './outer.cjs'; console.log(all.a);";
    assert!(captures(main, hidden));
    assert!(!captures(main, &listed));
    // Also where the file keeps its object: the build knows no variable behind a member of a built-in module.
    let over_a_library = hidden.replace("./inner.cjs", "node:path");
    assert!(captures(main, &over_a_library));
    // An import statement is bound to what the getter returns, also where a listed getter would have a copy.
    let files = [
        ("main.mjs", IMPORTS_OF_A[0]),
        ("outer.cjs", hidden),
        ("inner.cjs", "if (Math.random()) exports.a = 1;"),
    ];
    with_exports(&files, |exports, input| {
        let [outer, inner] = ["outer.cjs", "inner.cjs"].map(|name| module_named(input, name));
        let a = atom(input, "a");
        assert_eq!(exports.owner_of(outer, a), Some((inner, a)));
    });
    for main in &IMPORTS_OF_A[..1] {
        assert!(!captures(main, hidden), "{main}");
    }
}

const MARKER: &str = "Object.defineProperty(exports, '__esModule', { value: true });\n";

// A file with the marker and a getter for `name` that returns the `default` of `below`.
fn getter_of_default(name: &str, attributes: &str, below: &str) -> String {
    format!(
        "{MARKER}var below_1 = require('./{below}');\n\
        Object.defineProperty(exports, '{name}', {{ {attributes}get: function () {{ return below_1.default; }} }});"
    )
}

#[test]
fn an_import_holds_the_member_named_default_of_a_file_whose_default_is_its_value() {
    let marked = format!("{MARKER}exports.default = 1;");
    for (name, main) in [
        ("default", "import a from './outer.cjs'; console.log(a);"),
        ("a", IMPORTS_OF_A[0]),
        ("a", IMPORTS_OF_A[2]),
    ] {
        let outer = getter_of_default(name, "enumerable: true, ", "inner.cjs");
        let owners_of_copies = |inner: &str| {
            let files = [
                ("main.mjs", main),
                ("outer.cjs", &outer[..]),
                ("inner.cjs", inner),
            ];
            with_exports(&files, |exports, input| {
                let [outer, inner] = ["outer.cjs", "inner.cjs"].map(|name| file_named(input, name));
                let shapes = [outer, inner].map(|file| exports.shape(ModuleRef::File(file)));
                assert_eq!(shapes, [Shape::Names; 2], "{main}");
                let name = atom(input, name);
                match exports.member_named(ModuleRef::File(outer), name) {
                    Some(Member::Variable(returned)) => {
                        let owner = (ModuleRef::File(inner), atom(input, "default"));
                        assert_eq!(exports.names_by_id.get(&returned), Some(&owner), "{main}");
                    }
                    member => panic!("{member:?}"),
                }
                let copies = exports.copies(outer).iter();
                let owners = copies.map(|copy| exports.names_by_id[copy]);
                owners.collect::<Vec<(ModuleRef, Atom)>>() == [(ModuleRef::File(outer), name)]
            })
        };
        assert!(owners_of_copies("exports.default = 1;"), "{main}");
        assert!(
            owners_of_copies("module.exports = { default: 1 };"),
            "{main}"
        );
        assert!(!owners_of_copies(&marked), "{main}");
    }
}

#[test]
fn a_getter_over_an_es_module_that_hands_on_the_value_of_a_file_keeps_its_object() {
    let above = getter_of_default("a", "enumerable: true, ", "between.mjs");
    let shape_over = |inner: &str| {
        let files = [
            (
                "main.mjs",
                "import { a } from './above.cjs'; console.log(a);",
            ),
            ("above.cjs", &above[..]),
            ("between.mjs", "export { default } from './inner.cjs';"),
            ("inner.cjs", inner),
        ];
        shapes_of(&files, ["above.cjs"])
    };
    assert_eq!(shape_over("exports.default = 1;"), [Shape::Value]);
    let marked = format!("{MARKER}exports.default = 1;");
    assert_eq!(shape_over(&marked), [Shape::Names]);
}

#[test]
fn a_getter_that_is_not_enumerable_is_a_name_only_where_an_import_finds_what_it_returns() {
    let marked = format!("{MARKER}exports.default = 1;");
    let shape_of_outer = |name: &str, main: &str, inner: &str| {
        let outer = getter_of_default(name, "", "inner.cjs");
        let files = [
            ("main.mjs", main),
            ("outer.cjs", &outer[..]),
            ("inner.cjs", inner),
        ];
        shapes_of(&files, ["outer.cjs"])
    };
    let main = IMPORTS_OF_A[0];
    assert_eq!(shape_of_outer("a", main, &marked), [Shape::Names]);
    assert_eq!(
        shape_of_outer("a", main, "exports.default = 1;"),
        [Shape::Value]
    );
    // Whoever lists the names passes over the getter, so the `default` of the file is its value.
    let main = "import a from './outer.cjs'; console.log(a);";
    assert_eq!(shape_of_outer("default", main, &marked), [Shape::Value]);
}

#[test]
fn an_import_of_a_getter_that_is_not_enumerable_is_checked_where_the_file_keeps_its_object() {
    let outer = getter_of_default("a", "", "inner.cjs");
    let files = [
        ("main.mjs", IMPORTS_OF_A[0]),
        ("outer.cjs", &outer[..]),
        ("inner.cjs", "exports.default = 1;"),
    ];
    with_exports(&files, |exports, input| {
        let checked = exports.checked_copies(file_named(input, "main.mjs")).iter();
        let checked: Vec<(ModuleRef, Atom)> =
            checked.map(|entry| exports.names_by_id[&entry.0]).collect();
        assert_eq!(
            checked,
            [(module_named(input, "outer.cjs"), atom(input, "a"))]
        );
    });
}

#[test]
fn the_marker_says_nothing_to_an_importer_in_a_package_of_type_module() {
    let inner = format!("{MARKER}exports.default = 1; exports.a = 2;");
    let outer = getter_of_default("a", "enumerable: true, ", "inner.cjs");
    for main in [
        "export { default } from './inner.cjs';",
        "import * as all from './inner.cjs'; console.log(all.default);",
    ] {
        let shape_in = |package: &str| {
            let files = [
                ("main.mjs", main),
                ("inner.cjs", &inner[..]),
                ("package.json", package),
            ];
            with_exports(&files, |exports, input| {
                let inner = module_named(input, "inner.cjs");
                assert_eq!(exports.marker(inner), Some(true), "{main}");
                exports.shape(inner)
            })
        };
        assert_eq!(shape_in("{}"), Shape::Names, "{main}");
        assert_eq!(shape_in(r#"{ "type": "module" }"#), Shape::Value, "{main}");
    }
    // A name is bound to the variable as elsewhere, and a getter that returns the member has a copy.
    let files = [
        (
            "main.mjs",
            "import { a } from './inner.cjs'; import { a as b } from './outer.cjs'; console.log(a, b);",
        ),
        ("outer.cjs", &outer[..]),
        ("inner.cjs", &inner[..]),
        ("package.json", r#"{ "type": "module" }"#),
    ];
    with_exports(&files, |exports, input| {
        let [outer, inner] = ["outer.cjs", "inner.cjs"].map(|name| file_named(input, name));
        let shapes = [outer, inner].map(|file| exports.shape(ModuleRef::File(file)));
        assert_eq!(shapes, [Shape::Names; 2]);
        let a = atom(input, "a");
        let own = exports.ids[&(ModuleRef::File(inner), a)];
        assert_eq!(exports.imported_member(own), Member::Variable(own));
        let copies = exports.copies(outer).iter();
        let copies: Vec<(ModuleRef, Atom)> = copies.map(|copy| exports.names_by_id[copy]).collect();
        assert_eq!(copies, [(ModuleRef::File(outer), a)]);
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

#[test]
fn a_call_through_the_namespace_hands_the_namespace_over() {
    let captures = |main: &str, k: &str| {
        let files = [("main.mjs", main), ("k.cjs", k)];
        with_exports(&files, |exports, input| {
            exports.face_captures(file_named(input, "k.cjs"))
        })
    };
    let calls_a = "import * as ns from './k.cjs'; console.log(ns.a());";
    for k in [
        "exports.a = function () { return this.b; }; exports.b = 1;",
        "exports.a = Math.random; exports.b = 1;",
        "Object.assign(exports, { a() { return this.b; }, b: 1 });",
    ] {
        assert!(captures(calls_a, k), "{k}");
    }
    for k in [
        "exports.a = function () { return 1; }; exports.b = 1;",
        "exports.a = () => 1; exports.b = 1;",
    ] {
        assert!(!captures(calls_a, k), "{k}");
    }
    let reads_this = "exports.a = function () { return this.b; }; exports.b = 1;";
    for main in [
        "import * as ns from './k.cjs'; console.log(ns['a']());",
        "import * as ns from './k.cjs'; console.log(ns.a``);",
        "import * as ns from './k.cjs'; console.log(ns.a?.());",
    ] {
        assert!(captures(main, reads_this), "{main}");
    }
    for main in [
        "import * as ns from './k.cjs'; console.log(ns.a);",
        "import * as ns from './k.cjs'; console.log((0, ns.a)());",
        "import * as ns from './k.cjs'; console.log(new ns.a());",
    ] {
        assert!(!captures(main, reads_this), "{main}");
    }
    // The value of the module is called.
    let calls_default = "import * as ns from './k.cjs'; console.log(ns.default());";
    assert!(captures(calls_default, "exports.b = 1;"));
}

#[test]
fn a_binding_that_a_getter_returns_is_a_variable_with_and_without_the_object() {
    let k = "Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return a; } }); const a = 1;";
    for (main, shape) in [
        ("import { a } from './k.cjs'; console.log(a);", Shape::Names),
        (
            "import k, { a } from './k.cjs'; console.log(k, a);",
            Shape::Value,
        ),
        (
            "import * as ns from './k.cjs'; console.log(ns, ns.a);",
            Shape::Value,
        ),
    ] {
        let files = [("main.mjs", main), ("k.cjs", k)];
        with_exports(&files, |exports, input| {
            let file = file_named(input, "k.cjs");
            assert_eq!(exports.shape(ModuleRef::File(file)), shape, "{main}");
            let Some(&super::Target::Binding(symbol)) = exports
                .targets
                .get(&(ModuleRef::File(file), atom(input, "a")))
            else {
                panic!("{main}");
            };
            assert!(exports.is_exported_binding(file, symbol.id), "{main}");
        });
    }
    // The text of the file looks at the object, so no import is bound to the binding.
    let files = [
        ("main.mjs", "import { a } from './k.cjs'; console.log(a);"),
        ("k.cjs", &format!("{k} console.log(exports);")),
    ];
    with_exports(&files, |exports, input| {
        let key = (module_named(input, "k.cjs"), atom(input, "a"));
        assert_eq!(exports.targets.get(&key), None);
    });
}

#[test]
fn a_helper_that_marks_the_module_before_it_defines_getters() {
    const HELPERS: &str = "var __defProp = Object.defineProperty;\nvar __markAsModule = (target) => __defProp(target, \"__esModule\", { value: true });\nvar __export = (target, all) => {\n  __markAsModule(target);\n  for (var name in all)\n    __defProp(target, name, { get: all[name], enumerable: true });\n};\n";
    let ask_module = |rest: &str| {
        let module = format!("{HELPERS}{rest}");
        ask(READS_A, &module, |exports, module, a| {
            let member = exports.member_named(module, a);
            (exports.shape(module), exports.marker(module), member)
        })
    };
    let (shape, marker, member) = ask_module("__export(exports, { a: () => a });\nvar a = 1;\n");
    assert_eq!((shape, marker), (Shape::Names, Some(true)));
    assert!(matches!(member, Some(Member::Binding(_))), "{member:?}");
    // The property that the helper defines takes no store.
    let (shape, marker, _) =
        ask_module("__export(exports, { a: () => a });\nvar a = 1;\nexports.__esModule = false;\n");
    assert_eq!((shape, marker), (Shape::Value, None));
    // Whoever finds the module half evaluated in front of the call finds no marker.
    let (shape, marker, _) =
        ask_module("require('./main.cjs');\n__export(exports, { a: () => a });\nvar a = 1;\n");
    assert_eq!((shape, marker), (Shape::Value, None));
}

#[test]
fn nothing_is_said_of_this_where_the_text_does_not_name_every_store() {
    let ignores_this = |module: &str| ask(READS_A, module, CommonJsExports::ignores_this);
    for module in [
        "Object.assign(exports, { a() { return this; } });",
        "exports.a = () => 1; console.log(exports);",
    ] {
        assert!(!ignores_this(module), "{module}");
    }
    // A getter that returns a name of a module that has only its object.
    let files = [
        ("main.cjs", READS_A),
        (
            "module.cjs",
            "var inner = require('./inner.cjs'); Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return inner.a; } });",
        ),
        (
            "inner.cjs",
            "Object.assign(exports, { a() { return this; } });",
        ),
    ];
    with_exports(&files, |exports, input| {
        assert!(!exports.ignores_this(module_named(input, "module.cjs"), atom(input, "a")));
    });
}
