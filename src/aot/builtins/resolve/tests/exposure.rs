use super::*;

const TSX: Setup = Setup {
    path: "/project/a.tsx",
    ..PROGRAM
};

macro_rules! kept_for_own_name {
    ($further:literal) => {
        concat!("var a; (a = globalThis).own ?? (a.own = {}); ", $further)
    };
}

const NOT_EXPOSED: &[(&str, BuiltinId)] = &[
    (kept_for_own_name!(""), BuiltinId::GlobalThis),
    (
        "var a; ((a = global) as any).own; a = self; a; function f() { a.other = 1; }",
        BuiltinId::GlobalThis,
    ),
    ("new Map();", BuiltinId::Map),
    ("Map();", BuiltinId::Map),
    ("Map``;", BuiltinId::Map),
    ("typeof Math;", BuiltinId::Math),
    ("x instanceof Map;", BuiltinId::Map),
    ("Math === x;", BuiltinId::Math),
    ("Math;", BuiltinId::Math),
    ("(Math, x);", BuiltinId::Math),
    ("if (Math) {}", BuiltinId::Math),
    ("while (Math) {}", BuiltinId::Math),
    ("for (; Math; Math) {}", BuiltinId::Math),
    ("Math ? x : y;", BuiltinId::Math),
    ("Math.zzz;", BuiltinId::Math),
    ("Math.floor = () => {};", BuiltinId::Math),
    ("Math = x;", BuiltinId::Math),
    ("`${Math}`;", BuiltinId::Math),
    ("o[Math];", BuiltinId::Math),
    ("({ [Math]: 1 });", BuiltinId::Math),
    ("switch (Math) {}", BuiltinId::Math),
    ("switch (x) { case Math: }", BuiltinId::Math),
    ("\"floor\" in Math;", BuiltinId::Math),
    ("Map.prototype.constructor;", BuiltinId::MapPrototype),
    ("Object.prototype.__proto__;", BuiltinId::ObjectPrototype),
    ("Object.prototype.valueOf();", BuiltinId::ObjectPrototype),
    ("URL.prototype.toString;", BuiltinId::URLPrototype),
];

const INHERITED_OBJECT_PROTOTYPE_MEMBERS: &[(&str, BuiltinId)] = &[
    (
        "process.__proto__ = { get all() { return this; } };",
        BuiltinId::Process,
    ),
    ("process.__proto__;", BuiltinId::Process),
    ("process[\"__proto__\"] = x;", BuiltinId::Process),
    ("process[`__proto__`];", BuiltinId::Process),
    ("process?.__proto__;", BuiltinId::Process),
    ("({ __proto__: a } = process);", BuiltinId::Process),
    ("(process as any).__proto__ = x;", BuiltinId::Process),
    ("const p = process; p.__proto__ = x;", BuiltinId::Process),
    ("process.constructor;", BuiltinId::Process),
    ("const { constructor } = process;", BuiltinId::Process),
    ("const { __proto__: above } = process;", BuiltinId::Process),
    ("process.valueOf();", BuiltinId::Process),
    ("process.__defineGetter__(\"all\", f);", BuiltinId::Process),
    ("Object.setPrototypeOf(process, x);", BuiltinId::Process),
    ("Reflect.setPrototypeOf(process, x);", BuiltinId::Process),
    ("Bun.__proto__ = {};", BuiltinId::Bun),
    ("Bun.constructor;", BuiltinId::Bun),
    ("globalThis.__proto__;", BuiltinId::GlobalThis),
    ("globalThis.constructor;", BuiltinId::GlobalThis),
];

const EXPOSED: &[(&str, BuiltinId)] = &[
    ("f(Math);", BuiltinId::Math),
    ("new f(Math);", BuiltinId::Math),
    ("f`${Math}`;", BuiltinId::Math),
    ("x = Math;", BuiltinId::Math),
    ("[Math];", BuiltinId::Math),
    ("[...Math];", BuiltinId::Math),
    ("({ Math });", BuiltinId::Math),
    ("({ a: Math });", BuiltinId::Math),
    ("function f() { return Math; }", BuiltinId::Math),
    ("() => Math;", BuiltinId::Math),
    ("throw Math;", BuiltinId::Math),
    ("class A extends Map {}", BuiltinId::Map),
    ("class A { m = Math; }", BuiltinId::Math),
    ("for (const k of Math) {}", BuiltinId::Math),
    ("for (const k in Math) {}", BuiltinId::Math),
    ("for (const k in f(Math)) {}", BuiltinId::Math),
    ("k in Math;", BuiltinId::Math),
    ("export default Math;", BuiltinId::Math),
    ("(x ? Math : y).floor;", BuiltinId::Math),
    ("f(x ? Math : y);", BuiltinId::Math),
    ("f(x || Math);", BuiltinId::Math),
    ("f(x ?? Math);", BuiltinId::Math),
    ("f((x, Math));", BuiltinId::Math),
    ("f(Math as any);", BuiltinId::Math),
    ("function f(a = Math) {}", BuiltinId::Math),
    ("const { a = Math } = x;", BuiltinId::Math),
    ("async function g() { await Math; }", BuiltinId::Math),
    ("function* g() { yield Math; }", BuiltinId::Math),
    ("delete Math.floor;", BuiltinId::Math),
    ("delete Math[\"floor\"];", BuiltinId::Math),
    ("delete Math.zzz;", BuiltinId::Math),
    (kept_for_own_name!("f(a);"), BuiltinId::GlobalThis),
    (kept_for_own_name!("() => a;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a.Bun;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a.constructor;"), BuiltinId::GlobalThis),
    (
        kept_for_own_name!("a.__proto__ = {};"),
        BuiltinId::GlobalThis,
    ),
    (kept_for_own_name!("a[k];"), BuiltinId::GlobalThis),
    (kept_for_own_name!("\"own\" in a;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a.own();"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a.own`t`;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("delete a.own;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a = {};"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a = process;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("a++;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("[a] = l;"), BuiltinId::GlobalThis),
    (kept_for_own_name!("for (a in o) {}"), BuiltinId::GlobalThis),
    (kept_for_own_name!("export { a };"), BuiltinId::GlobalThis),
    (kept_for_own_name!("eval(\"a\");"), BuiltinId::GlobalThis),
    ("export var a; (a = globalThis).own;", BuiltinId::GlobalThis),
    ("var a = 0; (a = globalThis).own;", BuiltinId::GlobalThis),
    ("let a; (a = globalThis).own;", BuiltinId::GlobalThis),
    (
        "function f(a) { (a = globalThis).own; }",
        BuiltinId::GlobalThis,
    ),
    ("var a; (a = globalThis).own();", BuiltinId::GlobalThis),
    ("var a; x = a = globalThis;", BuiltinId::GlobalThis),
    ("var a; (a = Date).own;", BuiltinId::Date),
    ("var a; (a = import.meta).own;", BuiltinId::ImportMeta),
    (
        "var a; (a = Object.prototype).own;",
        BuiltinId::ObjectPrototype,
    ),
];

const FOLLOWED: &[&str] = &[
    "Object.keys(process);",
    "Reflect.ownKeys(process);",
    "process.on(\"exit\", () => {});",
    "process.exit = () => {};",
    "Object.defineProperty(process, \"platform\", { get: () => \"made up\" });",
    "Object.defineProperty(process, \"cwd\", { get: () => () => f });",
    "Object.defineProperty(process, \"title\", { value: \"made up\" });",
    "process.exit = function () { f(); };",
    "process.exit = {};",
    "process.exit = new Map();",
    "process.argv = [];",
    "process.title = f;",
    "process.exitCode = f;",
    "process.madeUp = f;",
    "process.madeUp = function () { this.title; };",
    "function left() { f(); } process.exit = left;",
    "Object.defineProperty(process, \"exit\", { value() { f(); } });",
    "Object.defineProperty(process, \"exit\", { value: () => {} });",
    "Object.defineProperty(process, \"madeUp\", { value: f });",
    "process.on(\"exit\", function () { f(); });",
    "process.on(\"exit\", function () { function inner() { this.title; } });",
    "function heard() { f(); } process.once(\"exit\", heard);",
    "const heard = () => { f(); }; process.on(\"exit\", heard);",
    "process.on(f, () => {});",
    "process.on(\"exit\", () => {}, f);",
    "process.off(\"exit\", f);",
    "process.off(\"exit\", f) === x;",
    "if (process.removeAllListeners(\"exit\")) {}",
    "x = process.listenerCount(\"exit\");",
    "\"own\" in process;",
    "Object.getPrototypeOf(process);",
    "Object.getPrototypeOf(process) !== null;",
    "typeof Reflect.getPrototypeOf(process);",
    "const above = Object.getPrototypeOf(process); above !== x; if (above instanceof Object) {}",
    "process instanceof Object;",
    "process instanceof (Map as any);",
    "const above = Object.getPrototypeOf(process); Object.getPrototypeOf(above) === null;",
    "Object.defineProperty(process, \"own\", { value: f, writable: true });",
    "Object.defineProperty(process, \"own\", { get: () => 1, set: v => {} });",
    "x = Reflect.defineProperty(process, \"own\", { value: 1 });",
    "Object.defineProperties(process, { own: { value: 1 }, other: { get: () => 2 } });",
];

const HANDED_OVER: &[&str] = &[
    "for (const k in process) {}",
    "for (const k in process as any) {}",
    "f(process);",
    "process.on(\"exit\", function () { this.title; });",
    "process.exit = function () { this.title; };",
    "Object.defineProperty(process, \"title\", { value: function () { this.pid; } });",
    "Object.defineProperties(process, { title: { value() { this.pid; } } });",
    "Object.defineProperty(process, \"cwd\", { get: () => function () { this.title; } });",
    "Object.defineProperty(process, \"cwd\", { get: () => f });",
    "Object.defineProperty(process, \"cwd\", { get: () => { return f; } });",
    "process.exit = f;",
    "process.cwd = function () { return () => this; };",
    "function left() { this.title; } process.exit = left;",
    "(process as any).exit = function () { this.title; };",
    "process[\"exit\"] = function () { this.title; };",
    "process.exit ??= function () { this.title; };",
    "process.exit = new Proxy(f, g);",
    "process.exit = f();",
    "process.exit = f.g;",
    "process.exit = new f();",
    "process.argv0 = function () { this.title; };",
    "process.argv = f;",
    "process.on(\"exit\", new f());",
    "const p = process; p.exit = function () { this.title; };",
    "[process.exit] = f;",
    "({ a: process.exit } = f);",
    "for (process.exit of f) {}",
    "for (process.exit in f) {}",
    "Object.defineProperty(process, \"exit\", { value() { this.title; } });",
    "Object.defineProperty(process, \"exit\", { value() { return super.valueOf(); } });",
    "Object.defineProperty(process, \"exit\", { value() { return () => super.valueOf(); } });",
    "Object.defineProperty(process, \"exit\", { value(held = super.valueOf()) {} });",
    "Object.defineProperty(process, \"exit\", { async value() { return super.valueOf(); } });",
    "Object.defineProperty(process, \"exit\", { value() { super.argv0 = f; } });",
    "Object.defineProperties(process, { exit: { value() { return super.valueOf(); } } });",
    "Object.defineProperty(process, \"exit\", { value: function () { this.title; } });",
    "Object.defineProperty(process, \"exit\", { value: f });",
    "Object.defineProperty(process, \"exit\", { value });",
    "Object.defineProperties(process, { exit: { value() { this.title; } } });",
    "x = Reflect.defineProperty(process, \"exit\", { value() { this.title; } });",
    "process.once(\"exit\", function () { return () => this; });",
    "function heard() { this.title; } process.addListener(\"exit\", heard);",
    "const heard = function () { this.title; }; process.prependListener(\"exit\", heard);",
    "process.on(\"exit\", f);",
    "const heard = heard; process.on(\"exit\", heard);",
    "const a = b, b = a; process.on(\"exit\", a);",
    "let heard = () => {}; heard = f; process.on(\"exit\", heard);",
    "const p = process; p.on(\"exit\", function () { this.title; });",
    "process.on(...f);",
    "process.on(\"exit\", ...f);",
    "x = process.off(\"exit\", f);",
    "const held = process.removeListener(\"exit\", f);",
    "process.removeAllListeners(\"exit\").title;",
    "process.on(\"exit\", () => {}).on(\"exit\", () => {});",
    "f(process.once(\"exit\", () => {}));",
    "() => process.off(\"exit\", f);",
    "function f() { return process.off(\"exit\", f); }",
    "const p = process; x = p.off(\"exit\", f);",
    "process.off(\"exit\", f) + x;",
    "process.off(\"exit\", f) == x;",
    "`${process.off(\"exit\", f)}`;",
    "o[process.off(\"exit\", f)];",
    "Object.defineProperty(process, \"toString\", { value() { return this; } });",
    "Object.defineProperty(process, \"valueOf\", { value: f });",
    "x = Reflect.defineProperty(process, \"toString\", { value: f });",
    "Object.defineProperties(process, { own: { value: 1 }, toLocaleString: { value: f } });",
    "delete process.title;",
    "const p = process; delete p.title;",
    "new f(process);",
    "x.f(process);",
    "x = process;",
    "(x = process).pid;",
    "x.p = process;",
    "[process];",
    "({ a: process });",
    "function f() { return process; }",
    "export default process;",
    "export let p = process;",
    "export let p = process; p = x;",
    "export let p; p = process;",
    "let p = process; export { p };",
    "process[k];",
    "process.hasOwnProperty(k);",
    "process.zzz();",
    "process.zzz`a`;",
    "process.propertyIsEnumerable(k);",
    "process.__lookupGetter__(k);",
    "f(Object.getPrototypeOf(process));",
    "x = Object.getPrototypeOf(process);",
    "Object.getPrototypeOf(process).on;",
    "Object.getPrototypeOf(process)[k];",
    "Object.getPrototypeOf(x || process);",
    "Object.getPrototypeOf(x, process);",
    "const above = Object.getPrototypeOf(process); f(above);",
    "const above = Object.getPrototypeOf(process); above.on;",
    "const above = Object.getPrototypeOf(process); above.own = f;",
    "let above = Object.getPrototypeOf(process); above = x;",
    "export const above = Object.getPrototypeOf(process);",
    "const above = Object.getPrototypeOf(process); Object.setPrototypeOf(above, x);",
    "const above = Object.getPrototypeOf(process); Reflect.setPrototypeOf(above, x);",
    "const above = Object.getPrototypeOf(process); Object.defineProperty(above, \"own\", { value: 1 });",
    "x = Object.defineProperty(process, \"own\", { value: 1 });",
    "f(Object.defineProperties(process, { own: { value: 1 } }));",
    "Object.defineProperty(process, k, { value: 1 });",
    "Object.defineProperty(process, \"own\");",
    "Object.defineProperty(process, ...l);",
    "Object.defineProperty(process, \"own\", d);",
    "Object.defineProperty(process, \"own\", { ...d });",
    "Object.defineProperty(process, \"own\", { [k]: f });",
    "Object.defineProperty(process, \"own\", { get() { return this; } });",
    "Object.defineProperty(process, \"own\", { get: function () { return this; } });",
    "Object.defineProperty(process, \"own\", { get: f });",
    "Object.defineProperty(process, \"own\", { get });",
    "Object.defineProperty(process, \"own\", { set(v) { x = this; } });",
    "Object.defineProperty(process, \"own\", { get value() { return 1; } });",
    "Reflect.defineProperty(process, \"own\", { get() { return this; } });",
    "Object.defineProperties(process, d);",
    "Object.defineProperties(process, { own: d });",
    "Object.defineProperties(process, { [k]: { value: 1 } });",
    "Object.defineProperties(process, { ...d });",
    "Object.defineProperties(process, { own: { get() { return this; } } });",
    "f.call(process);",
    "f.bind(process);",
    "function f() {} f.call(process);",
    "process.cwd.call(x, process);",
    "Object.setPrototypeOf(x, process);",
    "Object.defineProperty(x, \"p\", process);",
    "Object.defineProperty(x, \"p\", { value: process });",
    "Object.values(process);",
    "Object.assign({}, process);",
    "console.log(process);",
    "JSON.stringify(process);",
    "({ ...process });",
    "const copy = { a: 1, ...process };",
    "k in process;",
    "Reflect.has(process, k);",
    "Object.hasOwn(process, k);",
    "Object.prototype.hasOwnProperty.call(process, k);",
    "Object.prototype.propertyIsEnumerable.apply(process, [k]);",
    "Object.prototype.valueOf.call(process);",
    "console.log.call(process);",
    "process.on.call(process, k, f);",
    "const { pid } = c ? process : x;",
    "f(...process);",
    "const { ...rest } = process;",
    "const { [k]: a } = process;",
    "import fs from \"node:fs\"; fs.writeSync(process);",
];

#[test]
fn object_whose_every_use_is_in_sight_is_not_exposed() {
    for &source in FOLLOWED {
        with_case(PROGRAM, source, |case| {
            assert!(case.mentions(BuiltinId::Process), "{source}");
            assert!(case.resolved.exposed().is_empty(), "{source}");
        });
    }
}

#[test]
fn look_at_what_process_inherits_from_node_events_is_noted_and_hands_process_to_nobody() {
    for source in [
        "process._eventsCount;",
        "typeof process._eventsCount;",
        "process?._eventsCount;",
        "process[\"_eventsCount\"];",
        "process._eventsCount++;",
        "process._eventsCount ??= 1;",
        "(process as any)._eventsCount;",
        "const p = process; p._eventsCount;",
        "const { _eventsCount } = process;",
        "\"_eventsCount\" in process;",
        "Object.getPrototypeOf(Object.getPrototypeOf(process)) === x;",
        "Reflect.getPrototypeOf(Object.getPrototypeOf(process)) === x;",
        "const above = Object.getPrototypeOf(process); Object.getPrototypeOf(above) === null;",
        "Object.getOwnPropertySymbols(Object.getPrototypeOf(Object.getPrototypeOf(process)));",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                case.resolved.inspects_prototype_chain_of_process(),
                "{source}"
            );
            assert!(case.resolved.exposed().is_empty(), "{source}");
        });
    }
    for source in [
        "process.madeUp;",
        "\"madeUp\" in process;",
        "const { madeUp } = process;",
        "process.title;",
        "process.on(x, () => {});",
        "Object.getPrototypeOf(process) === x;",
        "const above = Reflect.getPrototypeOf(process); above !== null;",
        "Math._eventsCount;",
        "\"_eventsCount\" in Math;",
        "x._eventsCount;",
        "Object.getPrototypeOf(Object.getPrototypeOf(Math)) === x;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                !case.resolved.inspects_prototype_chain_of_process(),
                "{source}"
            );
        });
    }
}

#[test]
fn name_that_is_searched_for_is_a_mention_of_the_member() {
    for source in [
        "\"stdout\" in process;",
        "Object.defineProperty(process, \"stdout\", { value: 1 });",
        "Reflect.defineProperty(process, \"stdout\", { value: 1 });",
        "Object.defineProperties(process, { own: { value: 1 }, stdout: { value: 1 } });",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.mentions(BuiltinId::ProcessStdout), "{source}");
            assert!(case.resolved.exposed().is_empty(), "{source}");
        });
    }
}

#[test]
fn code_of_bun_may_link_what_stands_above_an_object_again() {
    let source = "const above = Object.getPrototypeOf(process); if (above !== null) Object.setPrototypeOf(above, x);";
    with_case(RUNTIME, source, |case| {
        assert!(case.mentions(BuiltinId::Process));
        assert!(case.resolved.exposed().is_empty());
    });
    let kept = "const above = Object.getPrototypeOf(process); y = Object.setPrototypeOf(above, x);";
    with_case(RUNTIME, kept, |case| {
        assert!(case.exposes(BuiltinId::Process))
    });
}

#[test]
fn what_is_laid_above_process_answers_a_name_that_process_has_only_under_its_flag() {
    for name in [
        "noDeprecation",
        "noProcessWarnings",
        "pendingDeprecation",
        "throwDeprecation",
        "traceDeprecation",
        "traceProcessWarnings",
        "_debugEnd",
        "_debugProcess",
        "_startProfilerIdleNotifier",
        "_stopProfilerIdleNotifier",
    ] {
        for source in [
            format!("process.{name};"),
            format!("process.{name} = true;"),
            format!("const {{ {name} }} = process;"),
        ] {
            with_case(PROGRAM, &source, |case| {
                assert!(
                    case.resolved.process_reaches_code_on_its_prototypes(),
                    "{source}"
                );
                assert!(case.resolved.exposed().is_empty(), "{source}");
            });
            with_case(RUNTIME, &source, |case| {
                assert!(
                    !case.resolved.process_reaches_code_on_its_prototypes(),
                    "{source}"
                );
                assert!(!case.exposes(BuiltinId::Process), "{source}");
            });
        }
    }
}

#[test]
fn what_a_program_lays_under_a_name_that_some_runs_give_process_answers_native_code() {
    for source in [
        "Object.defineProperty(x, 'noDeprecation', y);",
        "x.__defineGetter__('throwDeprecation', y);",
        "const key = 'no' + 'Deprecation'; Reflect.defineProperty(x, key, y);",
        "Object.defineProperty(x, `traceDeprecation`, y);",
        "Object.defineProperties(x, { noDeprecation: y });",
        "x.__proto__ = { get noProcessWarnings() {} };",
        "class Above { get pendingDeprecation() {} }",
        "x = class { set traceProcessWarnings(value) {} };",
        "x.noDeprecation = y;",
        "function noDeprecation() {}",
        "export const throwDeprecation = y;",
        "enum Names { traceDeprecation }",
        "class Descriptors { constructor(public noDeprecation: PropertyDescriptor) {} }",
        "Object.defineProperty(x, 'no\\x44eprecation', y);",
        "Object.defineProperties(x, { no\\u0044eprecation: y });",
        "new Proxy(x, y);",
        "Proxy.revocable(x, y);",
        "Reflect.construct(Proxy, [x, y]);",
        "const Made = Proxy;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                case.resolved.process_reaches_code_on_its_prototypes(),
                "{source}"
            );
            assert!(!case.exposes(BuiltinId::Process), "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert!(
                !case.resolved.process_reaches_code_on_its_prototypes(),
                "{source}"
            );
        });
    }
    for source in [
        "process.emitWarning('old', 'DeprecationWarning');",
        "Object.defineProperty(x, 'madeUp', y);",
        "Object.defineProperty(x, 'pid', y);",
        "Object.defineProperty(x, 'on', y);",
        "Object.defineProperties(x, { default: y, AbortController: y });",
        "class Above { get madeUp() {} }",
        "typeof Proxy === 'function';",
        "Proxy !== undefined;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                !case.resolved.process_reaches_code_on_its_prototypes(),
                "{source}"
            );
        });
    }
}

#[test]
fn what_is_laid_above_process_answers_a_name_that_process_lacks_on_the_platform() {
    let windows = Setup {
        platform: Platforms::WINDOWS,
        ..PROGRAM
    };
    with_case(windows, "process.getuid;", |case| {
        assert!(case.resolved.process_reaches_code_on_its_prototypes());
    });
    with_case(PROGRAM, "process.getuid;", |case| {
        assert!(!case.resolved.process_reaches_code_on_its_prototypes());
    });
}

#[test]
fn what_is_laid_above_process_answers_what_process_lacks() {
    for source in [
        "process.madeUp;",
        "process.madeUp = 1;",
        "process.madeUp ??= 1;",
        "process?.madeUp;",
        "typeof process.madeUp;",
        "(process as any).madeUp;",
        "globalThis.process.madeUp;",
        "const p = process; p.madeUp;",
        "const { madeUp } = process;",
        "`${process}`;",
        "process + x;",
        "+process;",
        "process++;",
        "--process;",
        "process += x;",
        "process == x;",
        "process < x;",
        "(x || process) + y;",
        "x instanceof process;",
        "o[process];",
        "process in o;",
        "({ [process]: 1 });",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                case.resolved.process_reaches_code_on_its_prototypes(),
                "{source}"
            );
            assert!(case.resolved.exposed().is_empty(), "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert!(
                !case.resolved.process_reaches_code_on_its_prototypes(),
                "{source}"
            );
            assert!(case.exposes(BuiltinId::Process), "{source}");
        });
    }
    let kept = "var a; (a = process).own ?? (a.own = {});";
    with_case(PROGRAM, kept, |case| {
        assert!(
            case.resolved.process_reaches_code_on_its_prototypes()
                || case.exposes(BuiltinId::Process)
        );
    });
    for source in [
        "process.title;",
        "process.on;",
        "process.title = x;",
        "const { pid, emit } = process;",
        "process === x;",
        "process instanceof x;",
        "\"madeUp\" in process;",
        "typeof process;",
        "!process;",
        "if (process) {}",
        "process && x;",
        "process ? x : y;",
        "Math.madeUp;",
        "`${Math}`;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(
                !case.resolved.process_reaches_code_on_its_prototypes(),
                "{source}"
            );
        });
    }
}

#[test]
fn left_of_instanceof_is_handed_to_the_method_of_the_right_where_the_program_can_lay_one() {
    let handed_on = with_case(PROGRAM, "f(process);", |case| case.resolved.uses().clone());
    for source in [
        "process instanceof x;",
        "process instanceof Map;",
        "process instanceof exports;",
        "class K {} process instanceof K;",
        "import { EventEmitter } from \"node:events\"; process instanceof EventEmitter;",
        "const p = process; p instanceof x;",
        "(y || process) instanceof x;",
        "switch (true) { case process instanceof x: }",
    ] {
        with_case(PROGRAM, source, |case| {
            let resolved = &case.resolved;
            assert!(!case.exposes(BuiltinId::Process), "{source}");
            assert!(resolved.hands_builtins_to_hooks_of_instanceof(), "{source}");
            assert!(!resolved.can_come_by_hook_of_instanceof(), "{source}");
            assert!(!resolved.loads_unknown_modules(), "{source}");
            let holds_all = |uses: &crate::builtins::RuntimeUses| {
                let mut functions = handed_on.functions.iter();
                functions.all(|function| uses.functions.contains(function))
            };
            assert!(!holds_all(resolved.uses()), "{source}");
            resolved.note_that_hooks_of_instanceof_may_exist();
            assert!(holds_all(resolved.uses()), "{source}");
            assert!(resolved.loads_unknown_modules(), "{source}");
        });
    }
    for source in ["x instanceof process;", "x instanceof y;", "f(process);"] {
        with_case(PROGRAM, source, |case| {
            assert!(
                !case.resolved.hands_builtins_to_hooks_of_instanceof(),
                "{source}"
            );
        });
    }
    for setup in [RUNTIME, TEST_RUN] {
        with_case(setup, "process instanceof x;", |case| {
            assert!(case.exposes(BuiltinId::Process));
            assert!(!case.resolved.hands_builtins_to_hooks_of_instanceof());
        });
    }
}

#[test]
fn a_file_says_whether_it_can_come_by_the_hook_of_instanceof() {
    for source in [
        "Symbol.hasInstance;",
        "class K { static [Symbol.hasInstance](v) { return v; } }",
        "const { hasInstance } = Symbol;",
        "Symbol[x];",
        "f(Symbol);",
        "new Proxy(f, g);",
        "Proxy.revocable(f, g);",
        "Object.getOwnPropertySymbols(f);",
        "Object.getOwnPropertyDescriptors(f);",
        "Reflect.ownKeys(f);",
        "f(Reflect);",
        "f(Object);",
        "f(globalThis);",
        "globalThis[x];",
        "eval(x);",
        "new Function(x);",
        "f.constructor(x);",
        "f[x];",
        "f.constructor.hasInstance;",
        "Symbol('a').constructor.hasInstance;",
        "Symbol.iterator.constructor.hasInstance;",
        "const list = f.constructor.getOwnPropertySymbols;",
        "const { ownKeys } = f;",
        "f['hasInstance'];",
        "g(f, 'hasInstance');",
        "f.Proxy;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.resolved.can_come_by_hook_of_instanceof(), "{source}");
        });
    }
    for source in [
        "process instanceof x;",
        "Symbol.iterator;",
        "class K { static make() {} }",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(!case.resolved.can_come_by_hook_of_instanceof(), "{source}");
        });
    }
}

#[test]
fn object_that_goes_out_of_sight_is_exposed() {
    for &source in HANDED_OVER {
        with_case(PROGRAM, source, |case| {
            assert!(case.exposes(BuiltinId::Process), "{source}")
        });
    }
}

#[test]
fn reading_an_inherited_object_prototype_member_exposes_the_holder() {
    let mut kept_in_sight = Vec::new();
    for &(source, id) in INHERITED_OBJECT_PROTOTYPE_MEMBERS {
        with_case(PROGRAM, source, |case| {
            if !case.exposes(id) {
                kept_in_sight.push(source);
            }
        });
    }
    assert!(kept_in_sight.is_empty(), "{kept_in_sight:#?}");
}

const THIS_OF_SLOPPY_FUNCTIONS: &[(&str, BuiltinId)] = &[
    ("(function () { return this; })();", BuiltinId::GlobalThis),
    ("function f() { var self = this; }", BuiltinId::GlobalThis),
    ("function f() { g.call(this); }", BuiltinId::GlobalThis),
    ("function f() { this.own(); }", BuiltinId::GlobalThis),
    ("function f() { this[k]; }", BuiltinId::GlobalThis),
    ("function f() { this.constructor; }", BuiltinId::GlobalThis),
    (
        "function f() { const { process } = this; }",
        BuiltinId::GlobalThis,
    ),
    ("function f() { return () => this; }", BuiltinId::GlobalThis),
    ("function f(a = this) {}", BuiltinId::GlobalThis),
    ("({ get all() { return this; } });", BuiltinId::GlobalThis),
    (
        "[1].forEach(function () { this.process; });",
        BuiltinId::Process,
    ),
    ("function f() { this.process.pid; }", BuiltinId::Process),
    ("function f() { this.process ??= x; }", BuiltinId::Process),
];

const THIS_OF_OTHER_CODE: &[&str] = &[
    "function f() { 'use strict'; return this; }",
    "'use strict'; function f() { return this; }",
    "x = this; const f = () => this;",
    "class A { m() { return this; } static { f(this); } }",
    "class A { m = this; n = () => this; }",
    "function f() { this.process = 1; this.own; this.own = this.other; }",
    "function f() { typeof this; this instanceof f; if (!this) {} this; }",
];

#[test]
fn this_of_a_sloppy_function_may_be_the_global_object() {
    let mut kept_in_sight = Vec::new();
    for &(source, id) in THIS_OF_SLOPPY_FUNCTIONS {
        with_case(SCRIPT, source, |case| {
            if !case.exposes(id) {
                kept_in_sight.push(source);
            }
        });
    }
    assert!(kept_in_sight.is_empty(), "{kept_in_sight:#?}");
}

#[test]
fn this_of_strict_code_and_of_a_file_is_not_the_global_object() {
    for &source in THIS_OF_OTHER_CODE {
        with_case(SCRIPT, source, |case| {
            assert!(case.resolved.exposed().is_empty(), "{source}");
        });
    }
    with_case(PROGRAM, "export function f() { return this; }", |case| {
        assert!(case.resolved.exposed().is_empty());
    });
    with_case(RUNTIME, "function f() { return this; }", |case| {
        assert!(case.resolved.exposed().is_empty());
    });
}

const THIS_THAT_IS_ONLY_STORED_THROUGH_OR_LOOKED_AT: &[&str] = &[
    "function f() { this.own = 1; }",
    "function f() { typeof this; }",
    "function f() { return () => { this.own = 1; }; }",
    "({ m() { this.own = 1; } });",
    "function f(a = this.own) {}",
];

#[test]
fn a_file_where_this_may_be_the_global_object_lets_in_what_nobody_names() {
    for &source in THIS_THAT_IS_ONLY_STORED_THROUGH_OR_LOOKED_AT {
        with_case(SCRIPT, source, |case| {
            assert!(case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
        with_case(SCRIPT, &format!("'use strict'; {source}"), |case| {
            assert!(!case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert!(!case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
    }
    with_case(SCRIPT, "class A { m() { this.own = 1; } }", |case| {
        assert!(!case.resolved.uses().lets_in_what_nobody_names);
    });
}

#[test]
fn a_file_that_hands_the_global_object_to_a_native_that_defines_lets_in_what_nobody_names() {
    for source in [
        "Object.defineProperty(globalThis, 'other', { value: 1 });",
        "Object.defineProperty(global, 'other', { value: 1 });",
        "Object.defineProperties(globalThis, { other: { value: 1 } });",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
    }
    let on_another_holder = "Object.defineProperty(Math, 'other', { value: 1 });";
    with_case(PROGRAM, on_another_holder, |case| {
        assert!(!case.resolved.uses().lets_in_what_nobody_names);
    });
}

case_tests! {
    accessor_defined_on_the_global_object_replaces_the_global: TEST_RUN,
        "globalThis.__defineGetter__('structuredClone', f); globalThis.__defineSetter__('fetch', f); Math.__defineGetter__('max', f);",
        |case| {
            let replaced = case.resolved.replaced_members();
            assert!(replaced.contains(&BuiltinId::StructuredClone));
            assert!(replaced.contains(&BuiltinId::Fetch));
            assert!(replaced.contains(&BuiltinId::MathMax));
            assert!(!replaced.contains(&BuiltinId::QueueMicrotask));
        };
    variable_that_may_hold_object_is_not_resolved: PROGRAM,
        "var a; if (!a) a = process; a.pid; function f(p) { p.pid; } f(process);",
        |case| {
            for text in ["a", "a.pid", "a = process", "p", "p.pid"] {
                assert!(case.exprs(text).iter().all(|&expr| case.resolved_at(expr).is_none()), "{text}");
            }
            assert_eq!(case.builtin("process"), Some(BuiltinId::Process));
        };
    function_member_exposes_nothing: PROGRAM, "f(Math.floor);", |case| {
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(case.resolved.exposed().is_empty());
    };
    class_heritage_exposes_class: PROGRAM, "class A extends Map {}", |case| {
        assert!(case.exposes(BuiltinId::Map));
        assert!(!case.exposes(BuiltinId::GlobalThis));
    };
    unexposed_lists_are_empty: PROGRAM, "console.log(1); Math.floor(2);", |case| {
        assert!(case.mentions(BuiltinId::ConsoleLog));
        assert!(case.resolved.exposed().is_empty());
    };
    dynamic_scope_exposes: SCRIPT, "with (o) { process.pid; }", |case| {
        assert!(case.mentions(BuiltinId::Process));
        assert!(case.exposes(BuiltinId::Process));
        assert!(!case.mentions(BuiltinId::ProcessPid));
    };
}

#[test]
fn uses_without_exposure() {
    for &(source, id) in NOT_EXPOSED {
        with_case(PROGRAM, source, |case| {
            assert!(case.mentions(id), "{source}");
            assert!(!case.exposes(id), "{source}");
        });
    }
}

#[test]
fn uses_with_exposure() {
    for &(source, id) in EXPOSED {
        with_case(PROGRAM, source, |case| {
            assert!(case.mentions(id), "{source}");
            assert!(case.exposes(id), "{source}");
        });
    }
    with_case(TSX, "<Map />;", |case| {
        assert!(case.exposes(BuiltinId::Map))
    });
}

#[test]
fn variable_kept_for_own_name_is_exposed_where_the_text_does_not_show_every_use() {
    let factory = Setup {
        jsx_factory_root: Some("a"),
        ..TSX
    };
    for (setup, source) in [
        (RUNTIME, kept_for_own_name!("")),
        (SCRIPT, kept_for_own_name!("with (o) { a.own; }")),
        (factory, kept_for_own_name!("<div />;")),
    ] {
        with_case(setup, source, |case| {
            assert!(case.exposes(BuiltinId::GlobalThis), "{source}");
        });
    }
    let source = "import * as jsc from \"bun:jsc\"; var a; (a = jsc).own;";
    with_case(PROGRAM, source, |case| {
        assert!(case.exposes(jsc_namespace()));
    });
}

#[test]
fn exposure_unit_is_object() {
    with_case(PROGRAM, "f(Array.prototype);", |case| {
        assert!(case.exposes(BuiltinId::ArrayPrototype));
        assert!(!case.exposes(BuiltinId::Array));
    });
    with_case(PROGRAM, "class C extends Bun.RedisClient {}", |case| {
        assert!(case.exposes(BuiltinId::BunRedisClient));
        assert!(case.mentions(BuiltinId::Bun));
        assert!(!case.exposes(BuiltinId::Bun));
    });
}

#[test]
fn lists_ascend_and_are_unique() {
    let source = "f(Math, process, Math, Array.prototype, Map); Math.floor; Math.floor;";
    with_case(PROGRAM, source, |case| {
        let mentioned = case.resolved.mentioned();
        assert!(mentioned.is_sorted_by(|left, right| left < right));
        let mut exposed = [
            BuiltinId::Math,
            BuiltinId::Process,
            BuiltinId::ArrayPrototype,
            BuiltinId::Map,
        ];
        exposed.sort_unstable();
        assert_eq!(case.resolved.exposed(), exposed);
        assert!(exposed.iter().all(|id| mentioned.contains(id)));
    });
}

#[test]
fn computed_key_read_exposes() {
    for source in [
        "process[k];",
        "process[k] = x;",
        "delete process[k];",
        "const p = process; p[k];",
        "import p from \"node:process\"; p[k];",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.mentions(BuiltinId::Process), "{source}");
            assert!(case.exposes(BuiltinId::Process), "{source}");
        });
    }
    with_case(PROGRAM, "Array.prototype[Symbol.iterator];", |case| {
        assert!(!case.exposes(BuiltinId::ArrayPrototype));
    });
}

#[test]
fn computed_key_read_of_global_object_exposes() {
    for source in ["globalThis[k];", "global[k];", "const g = self; g[k];"] {
        with_case(PROGRAM, source, |case| {
            assert!(case.exposes(BuiltinId::GlobalThis), "{source}");
        });
    }
}

#[test]
fn computed_key_read_of_required_namespace_exposes() {
    for (setup, source) in [
        (SCRIPT, "require(\"bun:jsc\")[k];"),
        (SCRIPT, "const jsc = require(\"bun:jsc\"); jsc[k];"),
        (
            PROGRAM,
            "const jsc = import.meta.require(\"bun:jsc\"); jsc[k];",
        ),
        (
            PROGRAM,
            "const jsc = process.getBuiltinModule(\"bun:jsc\"); jsc[k];",
        ),
        (PROGRAM, "import jsc = require(\"bun:jsc\"); jsc[k];"),
        (PROGRAM, "import * as jsc from \"bun:jsc\"; jsc[k];"),
    ] {
        with_case(setup, source, |case| {
            assert!(case.mentions(jsc_namespace()), "{source}");
            assert!(case.exposes(jsc_namespace()), "{source}");
        });
    }
}

#[test]
fn global_object() {
    with_case(PROGRAM, "f(globalThis);", |case| {
        assert!(case.exposes(BuiltinId::GlobalThis));
    });
    with_case(PROGRAM, "f(global);", |case| {
        assert!(case.exposes(BuiltinId::GlobalThis));
    });
    with_case(PROGRAM, "typeof globalThis;", |case| {
        assert!(!case.exposes(BuiltinId::GlobalThis));
    });
}

#[test]
fn global_object_alias_member() {
    for source in [
        "global.process.stdout;",
        "self.process.stdout;",
        "const g = global; g.process.stdout;",
        "const { process: p } = global;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.mentions(BuiltinId::Process), "{source}");
            assert!(!case.exposes(BuiltinId::Process), "{source}");
            assert!(!case.exposes(BuiltinId::GlobalThis), "{source}");
        });
    }
    with_case(PROGRAM, "global.process;", |case| {
        assert_builtin(case, "global.process", BuiltinId::Process);
    });
    with_case(PROGRAM, "global.zzz; globalThis.process.pid;", |case| {
        assert!(!case.exposes(BuiltinId::Process));
        assert!(!case.exposes(BuiltinId::GlobalThis));
    });
}

#[test]
fn destructured_member_without_alias_is_exposed() {
    with_case(PROGRAM, "let { prototype: p } = Array; p = x;", |case| {
        assert!(case.mentions(BuiltinId::ArrayPrototype));
        assert!(case.exposes(BuiltinId::ArrayPrototype));
        assert!(!case.exposes(BuiltinId::Array));
    });
    with_case(PROGRAM, "const { prototype: [first] } = Array;", |case| {
        assert!(case.exposes(BuiltinId::ArrayPrototype));
        assert!(!case.exposes(BuiltinId::Array));
    });
    with_case(PROGRAM, "const { prototype: p } = Array;", |case| {
        assert!(case.mentions(BuiltinId::ArrayPrototype));
        assert!(case.resolved.exposed().is_empty());
    });
}

#[test]
fn jsx_factory_is_exposed() {
    let setup = Setup {
        jsx_factory_root: Some("Bun"),
        ..TSX
    };
    with_case(setup, "<div />;", |case| {
        assert!(case.mentions(BuiltinId::Bun));
        assert!(case.exposes(BuiltinId::Bun));
    });
    with_case(setup, "1;", |case| assert!(!case.mentions(BuiltinId::Bun)));
}

#[test]
fn alias_read_as_jsx_factory_is_exposed() {
    let setup = Setup {
        jsx_factory_root: Some("h"),
        ..TSX
    };
    with_case(setup, "const h = Math; <div />;", |case| {
        assert!(case.exposes(BuiltinId::Math));
    });
    with_case(setup, "const h = Math;", |case| {
        assert!(case.mentions(BuiltinId::Math));
        assert!(!case.exposes(BuiltinId::Math));
    });
}

#[test]
fn decorator_metadata_type_is_exposed() {
    let setup = Setup {
        emits_decorator_metadata: true,
        ..PROGRAM
    };
    let source = "class E { @d a: Bun.Glob; }";
    with_case(setup, source, |case| {
        assert!(case.mentions(BuiltinId::Bun));
        assert!(case.mentions(BuiltinId::BunGlob));
        assert!(case.exposes(BuiltinId::BunGlob));
        assert!(!case.exposes(BuiltinId::Bun));
    });
    with_case(PROGRAM, source, |case| {
        assert!(!case.mentions(BuiltinId::Bun));
        assert!(!case.mentions(BuiltinId::BunGlob));
    });
    with_case(setup, "class E { a: Bun.Glob; }", |case| {
        assert!(!case.mentions(BuiltinId::BunGlob));
    });
}
