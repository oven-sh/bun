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
            "request k3.cjs",
            "request k2.cjs",
            "request k1.cjs",
            "request a.mjs",
        ];
        assert_eq!(plan.requests("main.mjs"), expected);
        assert_eq!(plan.requests("a.mjs"), ["request b.mjs", "request k2.cjs"]);
        let written = plan.graph.requests(plan.file("main.mjs")).iter();
        let written: Vec<ModuleRef> = written.map(|request| request.target).collect();
        assert_eq!(written, [plan.module("a.mjs"), plan.module("k1.cjs")]);
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
        assert_eq!(plan.requests("a.mjs"), ["request k.cjs", "request b.mjs"]);
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
