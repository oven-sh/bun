use super::*;

macro_rules! with_runner {
    ($source:literal) => {
        concat!(
            "import { expect, jest, mock, setSystemTime, spyOn, vi } from 'bun:test'; ",
            $source
        )
    };
}

const TEST_SCRIPT: Setup = Setup {
    runs_tests: true,
    ..SCRIPT
};

const REPLACED: &[(&str, &[BuiltinId])] = &[
    ("Date.now = f;", &[BuiltinId::DateNow]),
    ("Date['now'] = f;", &[BuiltinId::DateNow]),
    ("(Date as any).now = f;", &[BuiltinId::DateNow]),
    ("const d = Date; d.now = f;", &[BuiltinId::DateNow]),
    ("const key = 'now'; Date[key] = f;", &[BuiltinId::DateNow]),
    (
        "const p = Array.prototype; p.push = f;",
        &[BuiltinId::ArrayPrototypePush],
    ),
    (
        "const { prototype: p } = Array; p.push = f;",
        &[BuiltinId::ArrayPrototypePush],
    ),
    ("import m = Math; m.max = f;", &[BuiltinId::MathMax]),
    ("globalThis.Map = Fake;", &[BuiltinId::Map]),
    ("Set = Fake;", &[BuiltinId::Set]),
    ("delete Array.from;", &[BuiltinId::ArrayFrom]),
    ("Array.from &&= f;", &[BuiltinId::ArrayFrom]),
    ("Math.max++;", &[BuiltinId::MathMax]),
    ("[Math.max] = list;", &[BuiltinId::MathMax]),
    ("for (Math.max of list) {}", &[BuiltinId::MathMax]),
    (
        "Array.prototype[Symbol.iterator] = f;",
        &[
            BuiltinId::ArrayPrototypeSymbolIterator,
            BuiltinId::ArrayPrototypeValues,
        ],
    ),
    (
        "Math.max = f; Date.now = f; Math.max = g;",
        &[BuiltinId::MathMax, BuiltinId::DateNow],
    ),
    (
        "Object.defineProperty(Array.prototype, 'includes', { value: f });",
        &[BuiltinId::ArrayPrototypeIncludes],
    ),
    (
        "Reflect.deleteProperty(Atomics, 'store');",
        &[BuiltinId::AtomicsStore],
    ),
    (
        "Reflect.set(Buffer, 'concat', f);",
        &[BuiltinId::BufferConcat],
    ),
    ("Reflect.set({}, 'max', f, Math);", &[BuiltinId::MathMax]),
    ("Object.assign(Date, { now: f });", &[BuiltinId::DateNow]),
    (
        "Object.defineProperties(Math, { random: { value: f } });",
        &[BuiltinId::MathRandom],
    ),
    (with_runner!("spyOn(Date, 'now');"), &[BuiltinId::DateNow]),
    (
        with_runner!("jest.spyOn(Map.prototype, 'get');"),
        &[BuiltinId::MapPrototypeGet],
    ),
    (
        with_runner!("vi.spyOn(console, 'log');"),
        &[BuiltinId::ConsoleLog],
    ),
    (
        "import { spyOn as watch } from 'bun:test'; const texts = String.prototype; watch(texts, 'normalize');",
        &[BuiltinId::StringPrototypeNormalize],
    ),
    (
        with_runner!("for (const name of ['log', 'info']) spyOn(console, name);"),
        &[BuiltinId::ConsoleLog, BuiltinId::ConsoleInfo],
    ),
    (
        with_runner!("vi.stubGlobal('fetch', f);"),
        &[BuiltinId::Fetch],
    ),
    (
        with_runner!("vi.stubEnv('A', 'b').stubGlobal('fetch', f);"),
        &[BuiltinId::Fetch],
    ),
    (
        with_runner!("setSystemTime(new Date(0));"),
        &[BuiltinId::Date, BuiltinId::DateNow],
    ),
];

const OPENS_NOTHING: &[&str] = &[
    "clock.now = f;",
    "queue.push = f;",
    "clock[key] = f;",
    "delete clock.now;",
    "const Date = { now() {} }; Date.now = f;",
    "let Set; Set = Fake;",
    "const clock = { now: f, Date: 1 };",
    "console.log('now');",
    "Date.now(); new Date(); value instanceof Date; typeof Date;",
    "Date[key];",
    "const now = Date.now; list.map(Math.floor);",
    "class Clock extends Date {}",
    "if (false) Date.now = f;",
    "Object.create ||= f;",
    "Array.prototype.last = f;",
    "Object.defineProperty(clock, 'now', { value: f });",
    "Object.assign(clock, { now: f });",
    "Reflect.set(Atomics, 'store', f, {});",
    "function spyOn(object, name) {} spyOn(clock, 'now');",
    "function setSystemTime(time) {} setSystemTime(0);",
    "const jest = { useFakeTimers() {}, resetModules() {} }; jest.useFakeTimers(); jest.resetModules();",
    "const vi = { stubGlobal(name, value) {} }; vi.stubGlobal('fetch', f);",
    "const expect = { extend(matchers) {} }; expect.extend({ toBe() {} });",
    with_runner!("mock.module('node:fs', () => ({}));"),
    with_runner!("jest.fn().mockReturnValue(1);"),
    "typeof Bun.jest(import.meta.path, true).suite === 'function';",
    "var kept = Bun.jest(import.meta.path, true, true) | 0; (kept ??= Bun.jest(import.meta.path, true, true) | 0) & 8;",
];

const UNKNOWN_KEY: &[(&str, BuiltinId)] = &[
    ("Date[key] = f;", BuiltinId::Date),
    ("delete Date[key];", BuiltinId::Date),
    ("const d = Date; d[key] = f;", BuiltinId::Date),
    ("globalThis[key] = f;", BuiltinId::GlobalThis),
    (
        "Object.defineProperty(Date, key, { value: f });",
        BuiltinId::Date,
    ),
    ("Object.assign(Date, overrides);", BuiltinId::Date),
    ("Object.assign(Date, { [key]: f });", BuiltinId::Date),
    (with_runner!("spyOn(Date, key);"), BuiltinId::Date),
    (
        with_runner!("vi.stubGlobal(key, f);"),
        BuiltinId::GlobalThis,
    ),
];

const OBJECT_OUT_OF_SIGHT: &[(&str, BuiltinId)] = &[
    ("helper(Date);", BuiltinId::Date),
    ("const held = [Date];", BuiltinId::Date),
    ("export const clock = Date;", BuiltinId::Date),
    (
        "const math = Object.assign(Math, { tau: 6 }); helper(math);",
        BuiltinId::Math,
    ),
    (
        "helper(Object.defineProperty(Array.prototype, 'last', d));",
        BuiltinId::ArrayPrototype,
    ),
    (
        "var a; (a = Object.prototype).polluted ?? (a.polluted = 1);",
        BuiltinId::ObjectPrototype,
    ),
];

const OBJECT_ANSWERED_BY_A_CALL: &[(&str, BuiltinId)] = &[
    (
        "const D = Object.assign(Date, { zone: 1 }); helper(D);",
        BuiltinId::Date,
    ),
    (
        "export default Object.defineProperty(Array.prototype, 'x', d);",
        BuiltinId::ArrayPrototype,
    ),
    (
        "const D = Object.setPrototypeOf(Date, base); D.now = f;",
        BuiltinId::Date,
    ),
];

const NAMES_ADDED: &[(&str, BuiltinId, &str)] = &[
    (
        "Object.prototype.polluted = 1;",
        BuiltinId::ObjectPrototype,
        "polluted",
    ),
    (
        "Object.prototype.polluted ??= 1;",
        BuiltinId::ObjectPrototype,
        "polluted",
    ),
    (
        "Object.assign(Object.prototype, { polluted: 1 });",
        BuiltinId::ObjectPrototype,
        "polluted",
    ),
    (
        "Function.prototype.once = f;",
        BuiltinId::FunctionPrototype,
        "once",
    ),
    (
        "Object.defineProperty(Function.prototype, 'once', { value: f });",
        BuiltinId::FunctionPrototype,
        "once",
    ),
];

const SPY_ON_INHERITED_MEMBER: &str = with_runner!("spyOn(Uint8Array.prototype, 'set');");

const SPIES_ON_OTHER_OBJECTS: &str = with_runner!(
    "spyOn(clock, 'now'); jest.spyOn(queue.items, pick()); vi.spyOn(clock as any, 'tick');"
);

const SPY_HANDED_ON: &[&str] = &[
    "import { spyOn } from 'bun:test'; use(spyOn);",
    "import { spyOn } from 'bun:test'; export { spyOn };",
    "export { spyOn } from 'bun:test';",
    "import { jest } from 'bun:test'; export const { spyOn } = jest;",
    "import { jest } from 'bun:test'; const spies = [jest.spyOn];",
    "import { spyOn } from 'bun:test'; spyOn.call(null, clock, 'now');",
    "import { spyOn } from 'bun:test'; spyOn(...operands);",
];

const MOCK_HANDED_ON: &[&str] = &[
    with_runner!("use(mock);"),
    with_runner!("use(mock.module);"),
    with_runner!("const { doMock } = jest; doMock('./a', f);"),
];

const MOCK_IN_SIGHT: &[&str] = &[
    with_runner!("mock.module('./a', () => ({}));"),
    with_runner!("jest.mock('./a').mock('./b');"),
    with_runner!("mock(() => 1);"),
    with_runner!("mock.restore();"),
    with_runner!("jest.fn();"),
];

const MODULES_RESET: &[&str] = &[
    with_runner!("jest.resetModules();"),
    with_runner!("vi.resetModules();"),
    with_runner!("vi.clearAllMocks().resetModules();"),
];

const RUNNER_OUT_OF_SIGHT: &[&str] = &[
    "import * as runner from 'bun:test'; use(runner);",
    "import { jest } from 'bun:test'; use(jest);",
    "import { vi } from 'bun:test'; export { vi };",
    "import { vi } from 'bun:test'; var a; const spy = (a = vi).unlisted; spy(Date, 'now');",
    "import('bun:test').then(use);",
    "use(Bun.jest(import.meta.path));",
    "var kept; kept ??= Bun.jest(import.meta.path, true, true);",
    "const kept = [Bun.jest(import.meta.path, true, true)];",
];

// replaced_members lists a place and the canonical id of the object it holds.
fn with_canonical_ids(places: &[BuiltinId]) -> Vec<BuiltinId> {
    let objects = places.iter().map(|&place| table::canonical_id(place));
    let mut members: Vec<BuiltinId> = places.iter().copied().chain(objects).collect();
    members.sort_unstable();
    members.dedup();
    members
}

fn assert_finds_only(setup: Setup, source: &str, places: &[BuiltinId], holders: &[BuiltinId]) {
    with_case(setup, source, |case| {
        let found = case.resolved;
        assert_eq!(
            found.replaced_members(),
            with_canonical_ids(places),
            "{source}"
        );
        assert_eq!(found.opened_holders(), holders, "{source}");
        let finds_nothing_else = found.names_added().is_empty()
            && found.spy_calls().is_empty()
            && !found.hands_spy_on()
            && !found.hands_mock_on()
            && !found.resets_modules();
        assert!(finds_nothing_else, "{source}");
    });
}

fn assert_replaces_only(setup: Setup, source: &str, places: &[BuiltinId]) {
    assert_finds_only(setup, source, places, &[]);
}

fn assert_opens_only(setup: Setup, source: &str, holder: BuiltinId) {
    assert_finds_only(setup, source, &[], &[holder]);
}

fn replaces_and_opens_nothing(found: &ResolvedBuiltins) -> bool {
    found.replaced_members().is_empty() && found.opened_holders().is_empty()
}

#[test]
fn member_written_under_a_known_key_is_replaced() {
    for &(source, places) in REPLACED {
        assert_replaces_only(TEST_RUN, source, places);
    }
}

#[test]
fn code_that_writes_no_built_in_opens_nothing() {
    for &source in OPENS_NOTHING {
        assert_replaces_only(TEST_RUN, source, &[]);
    }
}

#[test]
fn unknown_key_opens_the_holder() {
    for &(source, holder) in UNKNOWN_KEY {
        assert_opens_only(TEST_RUN, source, holder);
    }
}

#[test]
fn key_that_hangs_on_itself_is_what_is_spelled_for_it() {
    // The name goes round as it is, and through more functions than anybody counts.
    for source in [
        "function put(name, left) { if (left) return put(name, left - 1); Object.defineProperty(Math, name, {}); } put('max', 6);",
        "function one(name, left) { if (left) return two(name, left - 1); Object.defineProperty(Math, name, {}); } function two(name, left) { one(name, left); } one('max', 6);",
        "function a(k) { b(k); } function b(k) { c(k); } function c(k) { d(k); } function d(k) { e(k); } function e(k) { Object.defineProperty(Math, k, {}); } a('max');",
    ] {
        assert_replaces_only(TEST_RUN, source, &[BuiltinId::MathMax]);
    }
    // `make` returns an object under its parameter, and one call passes a key of what another call has made. What a function returns may have got more keys.
    for source in [
        "function make(key) { return { [key]: 1 }; } for (const name of Object.keys(make('max'))) Object.assign(Math, make(name));",
        "function make(key) { return { [key]: 1 }; } for (const [name] of Object.entries(make('max'))) Object.assign(Math, make(name));",
        "function make(key) { return { [key]: 1 }; } for (const name of Object.keys(make('max'))) { Object.defineProperty(Math, name, {}); make(name); }",
        "function one(key) { return { [key]: 1 }; } function two(key) { return { [key]: 2 }; } for (const name of Object.keys(one('max'))) for (const inner of Object.keys(two(name))) Object.assign(Math, one(inner));",
    ] {
        with_case(TEST_RUN, source, |case| {
            assert_eq!(
                case.resolved.opened_holders(),
                [BuiltinId::Math],
                "{source}"
            );
        });
    }
}

#[test]
fn escaped_built_in_object_is_opened() {
    for &(source, object) in OBJECT_OUT_OF_SIGHT {
        assert_opens_only(TEST_RUN, source, object);
    }
}

#[test]
fn object_that_a_call_answers_is_opened_where_the_answer_goes_on() {
    for &(source, object) in OBJECT_ANSWERED_BY_A_CALL {
        with_case(TEST_RUN, source, |case| {
            let opened = case.resolved.opened_holders();
            assert!(opened.contains(&object), "{source}: {opened:?}");
        });
    }
}

#[test]
fn reading_an_inherited_object_prototype_member_opens_the_holder() {
    for source in [
        "Date.constructor;",
        "const { constructor } = Date;",
        "const { __proto__: above } = Date;",
    ] {
        with_case(TEST_RUN, source, |case| {
            let opened = case.resolved.opened_holders();
            assert!(opened.contains(&BuiltinId::Date), "{source}: {opened:?}");
        });
    }
}

#[test]
fn store_of_a_function_that_the_loader_calls_is_told() {
    let stores = [
        "Module._resolveFilename = f;",
        "Module['_resolveFilename'] = f;",
        "Module.prototype.require = f;",
        "const p = Module.prototype; p.require = f;",
        "Object.assign(Module, { _resolveFilename: f });",
        "Object.assign(Module, patches);",
    ];
    let others = [
        "const original = Module._resolveFilename; original.call(Module, name);",
        "Module.prototype.load = f;",
        "Date.now = f;",
    ];
    let tells = |setup: Setup, source: &str| {
        let source = format!("import Module from 'node:module'; {source}");
        with_case(setup, &source, |case| {
            case.resolved.stores_loader_functions()
        })
    };
    for source in stores {
        assert!(tells(TEST_RUN, source), "{source}");
        assert!(!tells(PROGRAM, source), "{source}");
    }
    for source in others {
        assert!(!tells(TEST_RUN, source), "{source}");
    }
}

#[test]
fn nothing_is_found_outside_a_test_run() {
    let replaced = REPLACED.iter().map(|row| row.0);
    let opened = UNKNOWN_KEY.iter().chain(OBJECT_OUT_OF_SIGHT);
    let of_runner = SPY_HANDED_ON.iter().chain(MOCK_HANDED_ON);
    let of_runner = of_runner.chain(MODULES_RESET).chain(RUNNER_OUT_OF_SIGHT);
    let sources = replaced.chain(opened.map(|row| row.0));
    let sources = sources.chain(of_runner.copied());
    for source in sources.chain([SPIES_ON_OTHER_OBJECTS, SPY_ON_INHERITED_MEMBER]) {
        with_case(PROGRAM, source, |case| {
            assert_no_writes_are_found(case.resolved, source);
            assert!(case.resolved.names_added().is_empty(), "{source}");
        });
    }
    with_case(RUNTIME, SPY_ON_INHERITED_MEMBER, |case| {
        assert!(case.resolved.names_added().is_empty());
    });
}

#[test]
fn executable_lists_new_names_except_on_object_prototype() {
    for &(source, holder, name) in NAMES_ADDED {
        with_case(PROGRAM, source, |case| {
            let added = (holder, case.atoms.intern(name.as_bytes()));
            let expected = (holder != BuiltinId::ObjectPrototype).then_some(added);
            let found = case.resolved;
            assert_eq!(found.names_added(), expected.as_slice(), "{source}");
            assert!(found.replaced_members().is_empty(), "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert!(case.resolved.names_added().is_empty(), "{source}");
        });
    }
}

#[test]
fn write_on_the_files_own_module_object_opens_nothing() {
    let source = "module.exports = f; exports.now = f; module.exports.push = f;";
    assert_replaces_only(TEST_SCRIPT, source, &[]);
}

#[test]
fn global_named_inside_a_with_statement_still_counts() {
    let source = "with (scope) { Date.now = f; }";
    assert_replaces_only(TEST_SCRIPT, source, &[BuiltinId::DateNow]);
}

#[test]
fn new_name_on_an_object_closed_to_new_names_is_listed() {
    for &(source, holder, name) in NAMES_ADDED {
        with_case(TEST_RUN, source, |case| {
            let name = case.atoms.intern(name.as_bytes());
            assert_eq!(case.resolved.names_added(), [(holder, name)], "{source}");
            assert!(replaces_and_opens_nothing(case.resolved), "{source}");
        });
    }
}

#[test]
fn names_added_are_unique_and_sorted_by_holder_then_write_order() {
    let source = "Object.prototype.second = 1; Function.prototype.once = f; Object.prototype.first = 1; Object.prototype.second = 2;";
    with_case(TEST_RUN, source, |case| {
        let name = |text: &str| case.atoms.intern(text.as_bytes());
        let mut expected = [
            (BuiltinId::ObjectPrototype, name("second")),
            (BuiltinId::FunctionPrototype, name("once")),
            (BuiltinId::ObjectPrototype, name("first")),
        ];
        expected.sort_by_key(|added| added.0);
        assert_eq!(case.resolved.names_added(), expected);
    });
}

#[test]
fn spy_on_an_inherited_member_replaces_it_and_adds_the_name_to_the_receiver() {
    with_case(TEST_RUN, SPY_ON_INHERITED_MEMBER, |case| {
        let prototype = BuiltinId::Uint8ArrayPrototype;
        let set = find_member(prototype, "set").expect("a typed array inherits set");
        assert_ne!(table::entry(set).holder, Some(prototype));
        assert_eq!(case.resolved.replaced_members(), [set]);
        assert!(case.resolved.opened_holders().is_empty());
        let name = case.atoms.intern(b"set");
        assert_eq!(case.resolved.names_added(), [(prototype, name)]);
        assert!(case.resolved.spy_calls().is_empty());
    });
}

#[test]
fn spy_on_an_object_that_is_no_built_in_is_listed() {
    with_case(TEST_RUN, SPIES_ON_OTHER_OBJECTS, |case| {
        let found = case.resolved;
        let spies = found.spy_calls();
        let calls: Vec<&str> = spies.iter().map(|spy| case.text_of(spy.call)).collect();
        let written_calls = [
            "spyOn(clock, 'now')",
            "jest.spyOn(queue.items, pick())",
            "vi.spyOn(clock as any, 'tick')",
        ];
        assert_eq!(calls, written_calls);
        let objects: Vec<&str> = spies.iter().map(|spy| case.text_of(spy.object)).collect();
        assert_eq!(objects, ["clock", "queue.items", "clock"]);
        let name = |text: &str| Some(case.atoms.intern(text.as_bytes()));
        let names: Vec<Option<Atom>> = spies.iter().map(|spy| spy.name).collect();
        assert_eq!(names, [name("now"), None, name("tick")]);
        assert!(replaces_and_opens_nothing(found));
        assert!(found.names_added().is_empty());
        assert!(!found.hands_spy_on() && !found.resets_modules());
    });
    let renamed =
        "import { jest } from 'bun:test'; const { spyOn: watch } = jest; watch(clock, 'now');";
    with_case(TEST_RUN, renamed, |case| {
        let objects = case.resolved.spy_calls().iter();
        let objects: Vec<&str> = objects.map(|spy| case.text_of(spy.object)).collect();
        assert_eq!(objects, ["clock"]);
        assert!(!case.resolved.hands_spy_on());
    });
}

#[test]
fn spy_on_used_as_a_value_sets_hands_spy_on() {
    for &source in SPY_HANDED_ON {
        with_case(TEST_RUN, source, |case| {
            let found = case.resolved;
            assert!(found.hands_spy_on() && !found.resets_modules(), "{source}");
            assert!(!found.hands_mock_on(), "{source}");
            assert!(replaces_and_opens_nothing(found), "{source}");
            assert!(found.spy_calls().is_empty(), "{source}");
        });
    }
}

#[test]
fn mock_used_as_a_value_sets_hands_mock_on() {
    for &source in MOCK_HANDED_ON {
        with_case(TEST_RUN, source, |case| {
            assert!(case.resolved.hands_mock_on(), "{source}");
        });
    }
}

#[test]
fn mock_whose_every_use_is_in_sight_does_not_set_hands_mock_on() {
    for &source in MOCK_IN_SIGHT {
        with_case(TEST_RUN, source, |case| {
            assert!(!case.resolved.hands_mock_on(), "{source}");
        });
    }
}

#[test]
fn reset_of_the_loaded_modules_is_noted() {
    for &source in MODULES_RESET {
        with_case(TEST_RUN, source, |case| {
            let found = case.resolved;
            assert!(found.resets_modules() && !found.hands_spy_on(), "{source}");
            assert!(replaces_and_opens_nothing(found), "{source}");
        });
    }
    let isolated = with_runner!("jest.isolateModules(load);");
    with_case(TEST_RUN, isolated, |case| {
        assert!(case.resolved.resets_modules());
    });
}

#[test]
fn escaped_test_runner_object_counts_as_a_call_of_every_writer_in_it() {
    for &source in RUNNER_OUT_OF_SIGHT {
        with_case(TEST_RUN, source, |case| {
            let found = case.resolved;
            assert!(found.hands_spy_on() && found.resets_modules(), "{source}");
            assert!(found.hands_mock_on(), "{source}");
        });
    }
}

#[test]
fn fake_timers_replace_the_timers() {
    for source in [
        with_runner!("jest.useFakeTimers();"),
        with_runner!("vi.useFakeTimers();"),
        with_runner!("jest.useRealTimers().useFakeTimers();"),
    ] {
        with_case(TEST_RUN, source, |case| {
            let found = case.resolved;
            let replaced = found.replaced_members();
            for timer in [
                Some(BuiltinId::SetTimeout),
                Some(BuiltinId::SetInterval),
                Some(BuiltinId::QueueMicrotask),
                find_member(BuiltinId::Process, "nextTick"),
            ] {
                let is_replaced = timer.is_some_and(|timer| replaced.contains(&timer));
                assert!(is_replaced, "{timer:?} in {replaced:?}");
            }
            let others = [BuiltinId::Fetch, BuiltinId::GlobalThis, BuiltinId::Process];
            assert!(!others.iter().any(|other| replaced.contains(other)));
            assert!(found.opened_holders().is_empty());
            assert!(!found.hands_spy_on() && !found.resets_modules());
        });
    }
}

#[test]
fn call_chained_on_the_result_of_a_test_runner_call_is_followed() {
    let source = with_runner!("vi.useFakeTimers().stubGlobal('fetch', f);");
    with_case(TEST_RUN, source, |case| {
        let found = case.resolved;
        let replaced = found.replaced_members();
        assert!(replaced.contains(&BuiltinId::SetTimeout), "{replaced:?}");
        assert!(replaced.contains(&BuiltinId::Fetch), "{replaced:?}");
        assert!(found.opened_holders().is_empty());
        assert!(!found.hands_spy_on() && !found.resets_modules());
    });
}

#[test]
fn matchers_are_written_on_the_holders_of_matchers() {
    let holders = table::HOLDERS_OF_MATCHERS;
    let spelled = with_runner!("expect.extend({ toBe() {} });");
    with_case(TEST_RUN, spelled, |case| {
        let replaced = case.resolved.replaced_members();
        let matchers = holders.into_iter();
        let matchers: Vec<BuiltinId> = matchers
            .filter_map(|holder| find_member(holder, "toBe"))
            .collect();
        assert!(!matchers.is_empty());
        for matcher in matchers {
            assert!(replaced.contains(&matcher), "{matcher:?} in {replaced:?}");
        }
        let opened = case.resolved.opened_holders();
        assert!(opened.is_empty(), "{opened:?}");
    });
    with_case(TEST_RUN, with_runner!("expect.extend(matchers);"), |case| {
        let opened = case.resolved.opened_holders();
        assert!(opened.contains(&BuiltinId::Expect), "{opened:?}");
        let opens_others = opened.iter().any(|opened| !holders.contains(opened));
        assert!(!opens_others, "{opened:?}");
        assert!(case.resolved.replaced_members().is_empty());
    });
}

#[test]
fn mock_of_a_native_module_replaces_its_namespace() {
    let source = with_runner!("mock.module('bun:jsc', () => ({}));");
    assert_replaces_only(TEST_RUN, source, &[jsc_namespace()]);
}
