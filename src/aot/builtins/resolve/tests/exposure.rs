use super::*;

const TSX: Setup = Setup {
    path: "/project/a.tsx",
    ..PROGRAM
};

const NOT_EXPOSED: &[(&str, BuiltinId)] = &[
    ("new Map();", BuiltinId::Map),
    ("Map();", BuiltinId::Map),
    ("Map``;", BuiltinId::Map),
    ("typeof Math;", BuiltinId::Math),
    ("x instanceof Map;", BuiltinId::Map),
    ("\"a\" in Math;", BuiltinId::Math),
    ("Math === x;", BuiltinId::Math),
    ("Math;", BuiltinId::Math),
    ("(Math, x);", BuiltinId::Math),
    ("if (Math) {}", BuiltinId::Math),
    ("while (Math) {}", BuiltinId::Math),
    ("for (; Math; Math) {}", BuiltinId::Math),
    ("Math ? x : y;", BuiltinId::Math),
    ("Math.zzz;", BuiltinId::Math),
    ("Math.floor = f;", BuiltinId::Math),
    ("Math = x;", BuiltinId::Math),
    ("`${Math}`;", BuiltinId::Math),
    ("o[Math];", BuiltinId::Math),
    ("({ [Math]: 1 });", BuiltinId::Math),
    ("switch (Math) {}", BuiltinId::Math),
    ("switch (x) { case Math: }", BuiltinId::Math),
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
    ("for (const k in Math) {}", BuiltinId::Math),
    ("for (const k of Math) {}", BuiltinId::Math),
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
];

const FOLLOWED: &[&str] = &[
    "var a; (a = process).pid; a.title;",
    "var a; (a = process).x ?? (a.x = 1);",
    "let p = process; p = x; p.pid;",
    "let p; p ??= process; p.pid;",
    "const p = c ? process : x; p.pid;",
    "var a; a = process; const b = a; b.pid;",
    "var a; a = process; function f() { return a.pid; }",
    "function f(p) { return p.pid; } f(process);",
    "const f = (a, p) => p.pid; f(1, process);",
    "const f = function (p) { p.pid; }; f(process);",
    "function F(p) { p.pid; } new F(process);",
    "function f(p) { g(p); } function g(q) { q.pid; } f(process);",
    "function f(p) { if (c) f(p); p.pid; } f(process);",
    "function f(p) { p = x; p.pid; } f(process);",
    "function f(p) { const { pid } = p; } f(process);",
    "Object.getPrototypeOf(process) !== null;",
    "const p = Object.getPrototypeOf(process); p instanceof F;",
    "Object.keys(process);",
    "Reflect.ownKeys(process);",
    "Object.setPrototypeOf(process, x);",
    "Object.defineProperty(process, \"x\", {});",
    "Reflect.defineProperty(process, \"x\", {});",
    "Object.defineProperties(process);",
    "Object.defineProperties(process, {});",
    "Object.defineProperties(process, { x: {} });",
    "Object.defineProperties(process, { x: {}, \"y\": {}, [\"z\"]: {}, 0: {}, [1]: {} });",
    "Object.defineProperties(process, { x, y() {}, get z() { return {}; }, set w(v) {} });",
    "Object.defineProperties(process, { x: {} } as T);",
    "Object.defineProperties(process, { x: {} }, k);",
    "var a; a = process; Object.defineProperties(a, { x: {} });",
    "process.cwd.call(process);",
    "process.cwd.bind(process);",
    "const cwd = process.cwd; cwd.call(process);",
    "const p = x || process; p.pid;",
];

const HANDED_OVER: &[&str] = &[
    "f(process);",
    "delete process.title;",
    "const p = process; delete p.title;",
    "Object.defineProperty(process, k, {});",
    "Reflect.defineProperty(process, k, {});",
    "Object.defineProperties(process, k);",
    "Object.defineProperties(process, { [k]: {} });",
    "Object.defineProperties(process, { x: {}, [k]: {} });",
    "Object.defineProperties(process, { ...k });",
    "Object.defineProperties(process, { x: {}, ...k });",
    "Object.defineProperties(process, ...k);",
    "Object.defineProperties(process, c ? { x: {} } : { y: {} });",
    "const d = { x: {} }; Object.defineProperties(process, d);",
    "Object.defineProperties(x, process);",
    "Object.defineProperties(x, { p: process });",
    "Object.defineProperties(x, { p: { value: process } });",
    "Object.defineProperties(...k, process, { x: {} });",
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
    "var a; a = process; eval(\"a\");",
    "var a; a = process; f(a);",
    "var a; a = process; a[k];",
    "process[k];",
    "process.hasOwnProperty(k);",
    "process.zzz();",
    "process.zzz`a`;",
    "process.propertyIsEnumerable(k);",
    "process.__lookupGetter__(k);",
    "for (const k in process) {}",
    "function f(p) { return p; } f(process);",
    "function f(p) { p[k]; } f(process);",
    "function f(p) { x = p; } f(process);",
    "function f(p) { arguments[0]; } f(process);",
    "function f(...p) {} f(process);",
    "function f([p]) {} f(process);",
    "function f(p) {} f(...x, process);",
    "function f(p) {} f(1, process);",
    "let f = function (p) {}; f = g; f(process);",
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

fn sorted<const N: usize>(mut ids: [BuiltinId; N]) -> [BuiltinId; N] {
    ids.sort_unstable();
    ids
}

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
fn object_that_goes_out_of_sight_is_exposed() {
    for &source in HANDED_OVER {
        with_case(PROGRAM, source, |case| {
            assert!(case.exposes(BuiltinId::Process), "{source}")
        });
    }
}

#[test]
fn binding_that_holds_two_objects_exposes_both() {
    for source in [
        "let p = process; p = console; p.x;",
        "function f(p) { p.x; } f(process); f(console);",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.exposes(BuiltinId::Process), "{source}");
            assert!(case.exposes(BuiltinId::Console), "{source}");
        });
    }
}

case_tests! {
    member_read_off_variable_is_mentioned: PROGRAM, "var a; (a = process).stdout; a.stdin;", |case| {
        assert!(case.mentions(BuiltinId::ProcessStdout));
        assert!(case.mentions(BuiltinId::ProcessStdin));
        assert!(!case.mentions(BuiltinId::ProcessStderr));
    };
    member_read_off_parameter_is_mentioned: PROGRAM,
        "function f(p) { g(p.stdout); } function g(q) { q.write; } f(process);",
        |case| {
            assert!(case.mentions(BuiltinId::ProcessStdout));
            assert!(!case.mentions(BuiltinId::ProcessStdin));
            assert!(case.resolved.exposed().is_empty());
        };
    member_of_global_object_read_off_variable_is_mentioned: PROGRAM,
        "var a; (a = globalThis).x ?? (a.x = 1); a.process.pid;",
        |case| {
            assert!(case.mentions(BuiltinId::ProcessPid));
            assert!(case.resolved.exposed().is_empty());
        };
    test_for_a_name_mentions_the_member_of_that_name: PROGRAM, "'stdout' in process; 'zzz' in process;", |case| {
        assert!(case.mentions(BuiltinId::ProcessStdout));
        assert!(!case.exposes(BuiltinId::Process));
    };
    definition_under_a_name_mentions_the_member_of_that_name: PROGRAM,
        "Object.defineProperty(process, 'stdout', {}); Reflect.defineProperty(process, 'stdin', {});",
        |case| {
            assert!(case.mentions(BuiltinId::ProcessStdout));
            assert!(case.mentions(BuiltinId::ProcessStdin));
            assert!(!case.mentions(BuiltinId::ProcessStderr));
            assert!(!case.exposes(BuiltinId::Process));
        };
    definition_under_written_keys_mentions_the_members_of_those_names: PROGRAM,
        "Object.defineProperties(process, { stdout: {}, 'stdin': {}, zzz: {} });",
        |case| {
            assert!(case.mentions(BuiltinId::ProcessStdout));
            assert!(case.mentions(BuiltinId::ProcessStdin));
            assert!(!case.mentions(BuiltinId::ProcessStderr));
            assert!(!case.exposes(BuiltinId::Process));
        };
    test_for_a_name_in_variable_mentions_the_member_of_that_name: PROGRAM,
        "var a; a = process; 'stdout' in a;",
        |case| {
            assert!(case.mentions(BuiltinId::ProcessStdout));
            assert!(!case.exposes(BuiltinId::Process));
        };
    prototype_that_is_only_looked_at_is_not_mentioned: PROGRAM,
        "const p = Object.getPrototypeOf(process); p !== null; p instanceof F;",
        |case| assert_eq!(case.resolved.mentioned(), sorted([
            BuiltinId::Object,
            BuiltinId::ObjectGetPrototypeOf,
            BuiltinId::Process,
        ]));
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
