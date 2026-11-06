use super::*;
use crate::ir::parallel::run_serially;
use crate::modules::BindInput;
use crate::modules::testing::{
    describe_requests_of, file_named, member_named, symbol_named, with_graph,
};

struct Planned<'a, 'i, 's> {
    graph: &'a ModuleGraph,
    input: &'a BindInput<'i, 's>,
}

fn with_plan(files: &[(&str, &str)], check: impl FnOnce(&Planned<'_, '_, '_>)) {
    with_graph(files, |graph, input| check(&Planned { graph, input }));
}

impl Planned<'_, '_, '_> {
    fn file(&self, name: &str) -> FileId {
        file_named(self.input, name)
    }

    fn module(&self, name: &str) -> ModuleRef {
        ModuleRef::File(self.file(name))
    }

    fn shape(&self, name: &str) -> Shape {
        self.graph.shape(self.module(name))
    }

    fn atom(&self, text: &str) -> Atom {
        self.input.files.atoms.intern(text.as_bytes())
    }

    /// The calls of `require` in the file, in the order of the text.
    fn calls(&self, name: &str) -> Vec<ExprId> {
        let file = self.file(name);
        let hir = self.input.files.hir(file);
        let sites = self.input.files.analysis(file).import_sites.iter();
        let mut calls: Vec<ExprId> = sites
            .filter_map(|site| match site.kind {
                ImportSiteKind::Require(call) | ImportSiteKind::ImportMetaRequire(call) => {
                    Some(call)
                }
                _ => None,
            })
            .collect();
        calls.sort_unstable_by_key(|&call| hir[call].pos);
        calls
    }

    fn sites(&self, name: &str) -> Vec<Site> {
        let file = self.file(name);
        let site_at = |call| self.graph.site(file, call).expect("a site");
        self.calls(name).into_iter().map(site_at).collect()
    }

    fn evaluates(&self, target: &str, is_bare: bool) -> Site {
        Site::Evaluate {
            target: self.module(target),
            is_bare,
            records: false,
        }
    }

    fn holder(&self, file: &str, name: &str) -> Option<View> {
        let file = self.file(file);
        self.graph
            .holder(file, symbol_named(self.input, file, name))
    }

    fn member(&self, file: &str, name: &str) -> Option<Member> {
        let file = self.file(file);
        self.graph
            .member(file, member_named(self.input, file, name))
    }

    fn variable(&self, module: &str, name: &str) -> Member {
        let variable = self.graph.variable_of(self.module(module), self.atom(name));
        Member::Variable(variable.expect("no binding asks for the name"))
    }

    fn exported(&self, file: &str, name: &str) -> Member {
        let file = self.file(file);
        let bound = self.input.files.bound(file);
        let exports = bound.symbol(bound.file_symbol).exports;
        let id = bound.lookup(exports, self.atom(name));
        Member::Binding(Sym {
            file,
            id: id.expect("the file does not export the name"),
        })
    }

    fn requests(&self, name: &str) -> Vec<String> {
        describe_requests_of(self.graph, self.input, self.module(name))
    }

    fn reads_as_value(&self, name: &str) -> Vec<bool> {
        let file = self.file(name);
        let is_read = |call| self.graph.is_site_read_as_value(file, call);
        self.calls(name).into_iter().map(is_read).collect()
    }
}

#[test]
fn require_of_an_es_module_is_an_import_at_that_point() {
    let main = "
        const a = require('./m.mjs');
        export const c = a.c + 1;
        export function f(x) { return a.f(x) + a.missing + a.__esModule; }
    ";
    let files = [
        ("main.mjs", main),
        ("m.mjs", "export const c = 1; export function f(x) {}"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.sites("main.mjs"), [plan.evaluates("m.mjs", true)]);
        assert_eq!(plan.requests("main.mjs"), ["request m.mjs require"]);
        let namespace = View::Namespace(plan.module("m.mjs"));
        assert_eq!(plan.holder("main.mjs", "a"), Some(namespace));
        let member = |name| plan.member("main.mjs", name);
        assert_eq!(member("c"), Some(plan.exported("m.mjs", "c")));
        assert_eq!(member("f"), Some(plan.exported("m.mjs", "f")));
        assert_eq!(member("missing"), Some(Member::Undefined));
        assert_eq!(member("__esModule"), Some(Member::Marker(true)));
        assert_eq!(plan.reads_as_value("main.mjs"), [false]);
        assert_eq!(plan.shape("m.mjs"), Shape::EsModule);
    });
}

#[test]
fn a_store_to_the_mark_of_an_es_module_leaves_its_reads_to_the_object() {
    let main = "
        const a = require('./m.mjs');
        function never() { a.__esModule = false; }
        exports.c = a.c;
        require('./reader.cjs');
    ";
    let reader = "const a = require('./m.mjs'); exports.mark = a.__esModule;";
    let files = [
        ("main.cjs", main),
        ("reader.cjs", reader),
        ("m.mjs", "export const c = 1;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.graph.marker(plan.module("m.mjs")), None);
        assert_eq!(plan.member("reader.cjs", "__esModule"), None);
        assert_eq!(plan.holder("reader.cjs", "a"), None);
    });
}

#[test]
fn the_mark_of_a_namespace_that_something_looks_at_is_read_from_the_object() {
    let files = [
        (
            "main.cjs",
            "console.log(require('./m.mjs')); require('./reader.cjs');",
        ),
        (
            "reader.cjs",
            "const a = require('./m.mjs'); exports.mark = a.__esModule;",
        ),
        ("m.mjs", "export const c = 1;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(
            plan.member("reader.cjs", "__esModule"),
            Some(Member::OnObject)
        );
        let namespace = View::Namespace(plan.module("m.mjs"));
        assert_eq!(plan.holder("reader.cjs", "a"), Some(namespace));
    });
}

#[test]
fn the_mark_of_exports_that_something_looks_at_is_read_from_the_object() {
    let files = [
        (
            "main.cjs",
            "console.log(require('./m.cjs')); require('./reader.cjs');",
        ),
        (
            "reader.cjs",
            "const a = require('./m.cjs'); exports.mark = a.__esModule;",
        ),
        ("m.cjs", "exports.__esModule = true; exports.c = 1;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.shape("m.cjs"), Shape::Value);
        assert_eq!(
            plan.member("reader.cjs", "__esModule"),
            Some(Member::OnObject)
        );
        assert_eq!(plan.holder("reader.cjs", "a"), None);
    });
}

#[test]
fn require_of_a_commonjs_module_binds_its_names() {
    let main = "
        const a = require('./m.cjs');
        exports.c = a.c + 1;
        exports.f = function (x) { return a.f(x); };
        a.d = 2;
    ";
    let files = [
        ("main.cjs", main),
        ("m.cjs", "exports.c = 1; exports.f = (x) => x;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.shape("m.cjs"), Shape::Names);
        assert_eq!(plan.sites("main.cjs"), [plan.evaluates("m.cjs", true)]);
        assert_eq!(plan.requests("main.cjs"), ["request m.cjs require"]);
        let m = plan.module("m.cjs");
        assert_eq!(plan.holder("main.cjs", "a"), Some(View::Exports(m)));
        let d = plan.variable("m.cjs", "d");
        assert_eq!(plan.member("main.cjs", "d"), Some(d));
        assert_eq!(plan.reads_as_value("main.cjs"), [false]);
        let a_c = plan.graph.member_named(m, plan.atom("c"));
        assert_eq!(a_c, Some(plan.variable("m.cjs", "c")));
    });
}

// What must work exactly as under `bun run`: a module that is required again while its body runs shows what it has stored so far.
#[test]
fn a_cycle_of_requires_reads_the_variables_as_far_as_they_are_stored() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.first, a.second);",
        ),
        (
            "a.cjs",
            "exports.first = 1; const b = require('./b.cjs'); exports.second = b.seen;",
        ),
        (
            "b.cjs",
            "const a = require('./a.cjs'); exports.seen = [a.first, a.second];",
        ),
    ];
    with_plan(&files, |plan| {
        let (a, b) = (plan.module("a.cjs"), plan.module("b.cjs"));
        assert!(plan.graph.half(a) && plan.graph.half(b));
        assert!(!plan.graph.half(plan.module("main.cjs")));
        assert!(!plan.graph.exposed(a) && !plan.graph.exposed(b));
        // Every site stays a site where it is written, and every read a read of the variable at that point.
        assert_eq!(plan.sites("a.cjs"), [plan.evaluates("b.cjs", true)]);
        assert_eq!(plan.sites("b.cjs"), [plan.evaluates("a.cjs", true)]);
        assert_eq!(plan.requests("a.cjs"), ["request b.cjs require"]);
        assert_eq!(plan.requests("b.cjs"), ["request a.cjs require"]);
        assert_eq!(plan.graph.shape(a), Shape::Names);
        assert_eq!(plan.holder("b.cjs", "a"), Some(View::Exports(a)));
        let variable = |name| Some(plan.variable("a.cjs", name));
        assert_eq!(plan.member("b.cjs", "first"), variable("first"));
        assert_eq!(plan.member("b.cjs", "second"), variable("second"));
    });
}

#[test]
fn in_a_cycle_a_replaced_exports_object_is_held_as_it_was_read() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        (
            "a.cjs",
            "const b = require('./b.cjs'); module.exports = function () { return b; };",
        ),
        (
            "b.cjs",
            "const a = require('./a.cjs'); exports.call = () => a();",
        ),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.shape("a.cjs"), Shape::Value);
        assert_eq!(plan.sites("b.cjs"), [plan.evaluates("a.cjs", true)]);
        // An ordinary constant, which holds what the variable held when the call ran.
        assert_eq!(plan.holder("b.cjs", "a"), None);
        assert_eq!(plan.reads_as_value("b.cjs"), [true]);
    });
}

#[test]
fn a_cycle_of_es_modules_through_require_is_left_to_the_loader() {
    let files = [
        (
            "first.mjs",
            "const second = require('./second.mjs'); export const name = 'first';",
        ),
        (
            "second.mjs",
            "const first = require('./first.mjs'); console.log(first.name);",
        ),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.sites("first.mjs"), [Site::AsToday]);
        assert_eq!(plan.sites("second.mjs"), [Site::AsToday]);
        assert_eq!(plan.holder("second.mjs", "first"), None);
        assert_eq!(plan.member("second.mjs", "name"), None);
        assert!(plan.requests("second.mjs").is_empty());
    });
}

#[test]
fn a_site_in_a_function_is_not_bare_and_still_binds() {
    let main = "exports.f = function () { const a = require('./m.cjs'); return a.c; };";
    let files = [("main.cjs", main), ("m.cjs", "exports.c = 1;")];
    with_plan(&files, |plan| {
        assert_eq!(plan.sites("main.cjs"), [plan.evaluates("m.cjs", false)]);
        assert!(plan.graph.exposed(plan.module("m.cjs")));
        let c = plan.variable("m.cjs", "c");
        assert_eq!(plan.member("main.cjs", "c"), Some(c));
        // The module keeps its error, so that behind the site it has run to its end.
        assert_eq!(plan.requests("main.cjs"), ["request m.cjs require"]);
    });
}

#[test]
fn what_a_call_gives_is_a_value_where_the_callee_is_tested() {
    let sources = [
        "const r = require; const a = r('./m.cjs'); exports.c = a.c;",
        "const a = require.call(null, './m.cjs'); exports.c = a.c;",
        "require = exports.other; const a = require('./m.cjs'); exports.c = a.c;",
        "const a = require?.('./m.cjs'); exports.c = a.c;",
    ];
    for source in sources {
        let files = [("main.cjs", source), ("m.cjs", "exports.c = 1;")];
        with_plan(&files, |plan| {
            assert_eq!(plan.holder("main.cjs", "a"), None, "{source}");
            assert_eq!(plan.shape("m.cjs"), Shape::Value, "{source}");
            let site = plan.evaluates("m.cjs", false);
            assert_eq!(plan.sites("main.cjs"), [site], "{source}");
        });
    }
}

#[test]
fn a_use_of_the_object_costs_that_module_its_names() {
    let sources = [
        "const a = require('./m.cjs'); console.log(a);",
        "const a = require('./m.cjs'); console.log(Object.keys(a));",
        "const a = require('./m.cjs'); console.log(a[exports.k]);",
        "const a = require('./m.cjs'); delete a.c;",
        "const a = require('./m.cjs'); console.log(typeof a);",
        "const a = require('./m.cjs'); console.log(a || 1);",
        "const a = require('./m.cjs'); [a.c] = [1];",
        "const a = require('./m.cjs'); console.log(a.hasOwnProperty);",
        "let a = require('./m.cjs'); a = 1;",
        "console.log([require('./m.cjs')]);",
        "const { c, ...rest } = require('./m.cjs');",
        "const { [exports.k]: c } = require('./m.cjs');",
    ];
    for source in sources {
        let files = [
            ("main.cjs", source),
            ("m.cjs", "exports.c = 1;"),
            ("n.cjs", "exports.c = 1;"),
        ];
        with_plan(&files, |plan| {
            assert_eq!(plan.shape("m.cjs"), Shape::Value, "{source}");
            assert_eq!(plan.reads_as_value("main.cjs"), [true], "{source}");
        });
    }
}

#[test]
fn a_use_that_only_tests_the_object_costs_nothing() {
    let sources = [
        "require('./m.cjs');",
        "const a = require('./m.cjs'); if (a) exports.c = a.c;",
        "const a = require('./m.cjs'); exports.c = a && a.c;",
        "const a = require('./m.cjs'); exports.c = !a;",
        "const a = require('./m.cjs'); exports.c = a == null;",
        "const a = require('./m.cjs'); exports.c = a !== undefined ? a.c : 0;",
        "var a = require('./m.cjs'); exports.c = a.c;",
        "const { c, d: e = 1 } = require('./m.cjs');",
        "exports.c = require('./m.cjs').c;",
        "exports.c = new (require('./m.cjs').c)();",
    ];
    for source in sources {
        let files = [("main.cjs", source), ("m.cjs", "exports.c = 1;")];
        with_plan(&files, |plan| {
            assert_eq!(plan.shape("m.cjs"), Shape::Names, "{source}");
            assert_eq!(plan.reads_as_value("main.cjs"), [false], "{source}");
        });
    }
}

#[test]
fn a_call_that_is_only_tested_is_read_where_the_module_is_one_value() {
    let sources = [
        "if (require('./m.cjs')) exports.c = 1;",
        "exports.c = !require('./m.cjs');",
        "exports.c = require('./m.cjs') == null;",
        "exports.c = require('./m.cjs') ? 1 : 2;",
        "exports.c = require('./m.cjs') && 1;",
    ];
    for source in sources {
        let files = [("main.cjs", source), ("m.cjs", "module.exports = false;")];
        with_plan(&files, |plan| {
            assert_eq!(plan.shape("m.cjs"), Shape::Value, "{source}");
            assert_eq!(plan.reads_as_value("main.cjs"), [true], "{source}");
        });
        let files = [("main.cjs", source), ("m.cjs", "exports.c = 1;")];
        with_plan(&files, |plan| {
            assert_eq!(plan.shape("m.cjs"), Shape::Names, "{source}");
            assert_eq!(plan.reads_as_value("main.cjs"), [false], "{source}");
        });
    }
}

#[test]
fn an_exported_holder_holds_the_object() {
    let files = [
        ("main.mjs", "export const m = require('./x.mjs');"),
        ("x.mjs", "export const a = 1;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.holder("main.mjs", "m"), None);
        assert_eq!(plan.reads_as_value("main.mjs"), [true]);
    });
}

#[test]
fn a_holder_that_an_import_alias_names_holds_the_object() {
    let sources = [
        "import m = require('./x.mjs'); import a = m.a; export const b = a + 1;",
        "import m = require('./x.mjs'); import a = m.a; export const b = a + m.c;",
        "import m = require('./x.mjs'); export import a = m.a;",
        "import m = require('./x.mjs'); namespace N { export import a = m.a; } export const b = N.a;",
        "const m = require('./x.mjs'); import a = m.a; export const b = a + 1;",
    ];
    for source in sources {
        let exporter = "export const a = 1; export const c = 2;";
        let files = [("main.ts", source), ("x.mjs", exporter)];
        with_plan(&files, |plan| {
            assert_eq!(plan.holder("main.ts", "m"), None, "{source}");
        });
    }
}

#[test]
fn a_holder_that_an_import_alias_nobody_reads_names_stands_for_the_module() {
    let main = "import m = require('./x.mjs'); import a = m.a; export const b = m.c;";
    let files = [
        ("main.ts", main),
        ("x.mjs", "export const a = 1; export const c = 2;"),
    ];
    with_plan(&files, |plan| {
        let namespace = View::Namespace(plan.module("x.mjs"));
        assert_eq!(plan.holder("main.ts", "m"), Some(namespace));
    });
}

#[test]
fn a_commonjs_module_whose_namespace_an_import_alias_names_keeps_its_object() {
    let main = "import * as m from './x.cjs'; import a = m.a; export const b = a + m.c;";
    let files = [
        ("main.ts", main),
        ("x.cjs", "exports.a = 1; exports.c = 2;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.shape("x.cjs"), Shape::Value);
    });
}

#[test]
fn a_require_site_of_a_namespace_that_is_looked_at_records() {
    let main = "import * as ns from './x.mjs'; require('./x.mjs'); console.log(ns);";
    let files = [("main.mjs", main), ("x.mjs", "export const a = 1;")];
    with_plan(&files, |plan| {
        let expected = Site::Evaluate {
            target: plan.module("x.mjs"),
            is_bare: true,
            records: true,
        };
        assert_eq!(plan.sites("main.mjs"), [expected]);
    });
}

#[test]
fn a_default_import_of_a_module_without_the_marker_is_its_exports() {
    let files = [
        ("main.mjs", "import d from './k.cjs'; console.log(d.one);"),
        ("k.cjs", "exports.one = 1;"),
    ];
    with_plan(&files, |plan| {
        let k = plan.module("k.cjs");
        let one = plan.variable("k.cjs", "one");
        assert_eq!(plan.member("main.mjs", "one"), Some(one));
        assert_eq!(plan.graph.variable_of(k, plan.atom("default")), None);
        assert_eq!(plan.graph.shape(k), Shape::Names);
    });
}

// `bun run` evaluates every CommonJS file of a graph of imports when it links the graph.
#[test]
fn the_commonjs_files_of_a_graph_run_first() {
    let files = [
        ("main.mjs", "import './a.mjs'; import './k1.cjs';"),
        (
            "a.mjs",
            "import './b.mjs'; import { two } from './k2.cjs'; console.log(two);",
        ),
        (
            "b.mjs",
            "import { three } from './k3.cjs'; console.log(three);",
        ),
        ("k1.cjs", "exports.one = 1;"),
        ("k2.cjs", "exports.two = 2;"),
        ("k3.cjs", "exports.three = 3;"),
    ];
    with_plan(&files, |plan| {
        let expected = [
            "request k1.cjs hoisted",
            "request k2.cjs hoisted",
            "request k3.cjs hoisted",
            "request a.mjs",
            "request k1.cjs",
        ];
        assert_eq!(plan.requests("main.mjs"), expected);
        assert_eq!(plan.requests("a.mjs"), ["request b.mjs", "request k2.cjs"]);
        let written = plan.graph.requests(plan.file("main.mjs")).iter();
        let written: Vec<ModuleRef> = written.map(|request| request.target).collect();
        assert_eq!(written, [plan.module("a.mjs"), plan.module("k1.cjs")]);
    });
}

// `bun run` makes what a data file exports when it loads the graph, so a function that is called across a cycle finds it.
#[test]
fn the_data_files_below_a_cycle_come_first_where_the_cycle_is_entered() {
    let files = [
        ("main.mjs", "import './hub.mjs';"),
        (
            "hub.mjs",
            "import './caller.mjs'; export { read } from './reader.mjs';",
        ),
        ("caller.mjs", "import { read } from './hub.mjs'; read();"),
        (
            "reader.mjs",
            "import data from './data.json'; import text from './text.txt'; export function read() { return [data, text]; }",
        ),
        ("data.json", "{ \"x\": 1 }\n"),
        ("text.txt", "text"),
    ];
    with_plan(&files, |plan| {
        let expected = [
            "request data.json hoisted",
            "request caller.mjs",
            "request reader.mjs",
        ];
        assert_eq!(plan.requests("hub.mjs"), expected);
        assert_eq!(plan.requests("main.mjs"), ["request hub.mjs"]);
        assert_eq!(plan.requests("caller.mjs"), ["request hub.mjs"]);
        let expected = ["request data.json", "request text.txt"];
        assert_eq!(plan.requests("reader.mjs"), expected);
    });
}

#[test]
fn every_module_at_which_a_cycle_may_be_entered_asks_for_the_data_files_below_it() {
    let files = [
        ("main.cjs", "require('./a.mjs'); import('./b.mjs');"),
        (
            "a.mjs",
            "import './b.mjs'; import data from './data.json'; export const read = () => data;",
        ),
        ("b.mjs", "import './c.mjs';"),
        ("c.mjs", "import { read } from './a.mjs'; read();"),
        ("data.json", "{ \"x\": 1 }\n"),
    ];
    with_plan(&files, |plan| {
        let expected = [
            "request data.json hoisted",
            "request b.mjs",
            "request data.json",
        ];
        assert_eq!(plan.requests("a.mjs"), expected);
        let expected = ["request data.json hoisted", "request c.mjs"];
        assert_eq!(plan.requests("b.mjs"), expected);
        assert_eq!(plan.requests("c.mjs"), ["request a.mjs"]);
    });
}

#[test]
fn a_data_file_below_no_cycle_keeps_its_place() {
    let files = [
        ("main.mjs", "import './a.mjs'; import './reader.mjs';"),
        ("a.mjs", "import './b.mjs';"),
        ("b.mjs", "import './a.mjs';"),
        (
            "reader.mjs",
            "import './a.mjs'; import data from './data.json'; console.log(data);",
        ),
        ("data.json", "{ \"x\": 1 }\n"),
    ];
    with_plan(&files, |plan| {
        let expected = ["request a.mjs", "request reader.mjs"];
        assert_eq!(plan.requests("main.mjs"), expected);
        assert_eq!(plan.requests("a.mjs"), ["request b.mjs"]);
        let expected = ["request a.mjs", "request data.json"];
        assert_eq!(plan.requests("reader.mjs"), expected);
    });
}

#[test]
fn an_es_module_that_is_required_links_a_graph_of_its_own() {
    let files = [
        ("main.cjs", "require('./a.mjs');"),
        ("a.mjs", "import './b.mjs';"),
        ("b.mjs", "import { one } from './k.cjs'; console.log(one);"),
        ("k.cjs", "exports.one = 1;"),
    ];
    with_plan(&files, |plan| {
        assert_eq!(plan.graph.prefix_roots(), [plan.file("a.mjs")]);
        let expected = ["request k.cjs hoisted", "request b.mjs"];
        assert_eq!(plan.requests("a.mjs"), expected);
    });
}

// `bun run` runs an imported CommonJS file while it loads the graph of the importer.
#[test]
fn what_an_imported_file_requires_is_required_during_a_load() {
    let files = [
        ("main.mjs", "import './k.cjs'; import './late.mjs';"),
        ("k.cjs", "require('./other.mjs');"),
        ("other.mjs", "export const one = 1;"),
        ("late.mjs", "export const two = 2;"),
    ];
    with_plan(&files, |plan| {
        let graph = &plan.graph;
        assert!(graph.is_required_during_load(plan.module("other.mjs")));
        assert!(!graph.is_required_during_load(plan.module("late.mjs")));
        assert!(!graph.is_loaded_by_loader(plan.module("main.mjs")));
    });
}

#[test]
fn the_loader_loads_a_program_where_a_required_module_imports_the_file_that_requires_it() {
    let files = [
        ("main.mjs", "import './k.cjs';"),
        ("k.cjs", "require('./other.mjs');"),
        ("other.mjs", "import './k.cjs';"),
    ];
    with_plan(&files, |plan| {
        for file in ["main.mjs", "k.cjs", "other.mjs"] {
            assert!(plan.graph.is_loaded_by_loader(plan.module(file)));
        }
    });
}

#[test]
fn the_run_time_answers_a_require_of_a_file_that_a_module_it_requires_imports() {
    let files = [
        (
            "main.mjs",
            "import './k.cjs'; import './late.cjs'; import './beside.cjs';",
        ),
        ("k.cjs", "exports.one = 1; require('./other.mjs');"),
        ("other.mjs", "import './k.cjs';"),
        ("beside.cjs", "exports.two = 2;"),
        (
            "late.cjs",
            "exports.f = () => require('./k.cjs').one + require('./beside.cjs').two;",
        ),
    ];
    with_plan(&files, |plan| {
        let graph = &plan.graph;
        assert!(graph.may_be_imported_while_it_runs(plan.module("k.cjs")));
        for file in ["main.mjs", "other.mjs", "beside.cjs", "late.cjs"] {
            assert!(!graph.may_be_imported_while_it_runs(plan.module(file)));
        }
        let sites = [Site::AsToday, plan.evaluates("beside.cjs", false)];
        assert_eq!(plan.sites("late.cjs"), sites);
        assert_eq!(plan.requests("late.cjs"), ["request beside.cjs require"]);
    });
}

#[test]
fn a_request_to_a_file_that_is_left_out_goes() {
    let files = [
        (
            "main.cjs",
            "exports.f = () => require('./a.cjs'); require('./b.cjs');",
        ),
        ("a.cjs", "exports.x = 1;"),
        ("b.cjs", "exports.x = 1;"),
    ];
    with_graph(&files, |_, input| {
        let mut graph = crate::modules::bind_modules(input).graph;
        let (main, a) = (file_named(input, "main.cjs"), file_named(input, "a.cjs"));
        graph.leave_out_files(&[a], &run_serially);
        let requests = graph.requests_of(ModuleRef::File(main)).iter();
        let targets: Vec<ModuleRef> = requests.map(|request| request.target).collect();
        assert_eq!(targets, [ModuleRef::File(file_named(input, "b.cjs"))]);
    });
}

#[test]
fn a_file_that_is_left_out_on_a_cycle_with_a_file_that_runs_keeps_its_requests() {
    let files = [
        ("main.mjs", "import { a, b } from './all.mjs'; a(b);"),
        (
            "all.mjs",
            "export * from './a.mjs'; export * from './b.mjs';",
        ),
        (
            "a.mjs",
            "import { b } from './all.mjs'; export const a = () => b;",
        ),
        (
            "b.mjs",
            "import { a } from './all.mjs'; export const b = a();",
        ),
    ];
    with_graph(&files, |_, input| {
        let mut graph = crate::modules::bind_modules(input).graph;
        let file = |name: &str| file_named(input, name);
        let all = file("all.mjs");
        graph.leave_out_files(&[all], &run_serially);
        assert!(graph.is_left_out(ModuleRef::File(all)));
        assert!(graph.is_placeholder(all));
        assert!(graph.record_files().contains(&all));
        assert!(graph.exports(all).is_empty());
        let targets_of = |name: &str| -> Vec<ModuleRef> {
            let requests = graph.requests_of(ModuleRef::File(file(name))).iter();
            requests.map(|request| request.target).collect()
        };
        for importer in ["main.mjs", "a.mjs", "b.mjs"] {
            assert_eq!(targets_of(importer), [ModuleRef::File(all)], "{importer}");
        }
        let behind = ["a.mjs", "b.mjs"].map(|name| ModuleRef::File(file(name)));
        assert_eq!(targets_of("all.mjs"), behind);
    });
}

#[test]
fn a_file_that_is_left_out_off_every_cycle_hands_its_requests_to_its_importers() {
    let files = [
        ("main.mjs", "import { a, b } from './all.mjs'; a(b);"),
        (
            "all.mjs",
            "export * from './a.mjs'; export * from './b.mjs';",
        ),
        (
            "a.mjs",
            "import { b } from './b.mjs'; export const a = () => b;",
        ),
        (
            "b.mjs",
            "import { a } from './a.mjs'; export const b = () => a;",
        ),
    ];
    with_graph(&files, |_, input| {
        let mut graph = crate::modules::bind_modules(input).graph;
        let (main, all) = (file_named(input, "main.mjs"), file_named(input, "all.mjs"));
        graph.leave_out_files(&[all], &run_serially);
        assert!(!graph.is_placeholder(all));
        assert!(!graph.record_files().contains(&all));
        let requests = graph.requests_of(ModuleRef::File(main)).iter();
        let targets: Vec<ModuleRef> = requests.map(|request| request.target).collect();
        let behind = ["a.mjs", "b.mjs"].map(|name| ModuleRef::File(file_named(input, name)));
        assert_eq!(targets, behind);
    });
}

#[test]
fn a_module_that_the_graph_has_never_heard_of_has_neutral_answers() {
    with_plan(&[("main.mjs", "export {};")], |plan| {
        let file = plan.file("main.mjs");
        let inner = ModuleRef::Inner {
            file,
            callback: FnId(7),
        };
        assert_eq!(plan.graph.shape(inner), Shape::AsToday);
        assert!(plan.graph.requests_of(inner).is_empty());
        assert!(plan.graph.requests_of(ModuleRef::Face(file)).is_empty());
        assert!(plan.graph.requests_of(ModuleRef::Check(file)).is_empty());
        assert!(!plan.graph.keeps_error(inner));
        assert!(plan.graph.exports_of(inner).is_empty());
        assert_eq!(plan.graph.inner_module(file, FnId(7)), None);
    });
}
