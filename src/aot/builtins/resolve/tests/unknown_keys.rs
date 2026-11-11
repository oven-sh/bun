use super::*;
use crate::builtins::{AsksOfText, RuntimeUses};

fn uses_of_text_that_only_may_hand_values_to_natives() -> RuntimeUses {
    RuntimeUses {
        asks: AsksOfText {
            may_hand_values_to_natives: true,
            ..AsksOfText::default()
        },
        ..RuntimeUses::default()
    }
}

const SPELL_WHAT_NO_BINDING_STANDS_FOR: &[(&str, BuiltinId)] = &[
    ("f.sort();", BuiltinId::ArrayPrototypeSort),
    ("f?.sort();", BuiltinId::ArrayPrototypeSort),
    ("f['call'];", BuiltinId::FunctionPrototypeCall),
    ("f[Symbol.iterator];", BuiltinId::ArrayIteratorPrototypeNext),
    (
        "const steps = Symbol.iterator; f[steps];",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    (
        "const { iterator } = Symbol; f[iterator];",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    (
        "const Marks = Symbol; f[Marks.iterator];",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    (
        "const steps = Symbol.iterator; const { [steps]: taken } = f;",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    ("const { map } = f;", BuiltinId::ArrayPrototypeMap),
    ("const { a: { map: m } } = f;", BuiltinId::ArrayPrototypeMap),
    ("function h({ map }) {}", BuiltinId::ArrayPrototypeMap),
    ("let map; ({ map } = f);", BuiltinId::ArrayPrototypeMap),
    ("let map; for ({ map } of f);", BuiltinId::ArrayPrototypeMap),
    (
        "for (const item of f) g(item);",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    ("[...f];", BuiltinId::ArrayIteratorPrototypeNext),
    ("g(...f);", BuiltinId::ArrayIteratorPrototypeNext),
    ("const [first] = f;", BuiltinId::ArrayIteratorPrototypeNext),
    (
        "let first; [first] = f;",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    (
        "function* h() { yield* f; }",
        BuiltinId::ArrayIteratorPrototypeNext,
    ),
    (
        "function* h() { yield f; }",
        BuiltinId::GeneratorPrototypeNext,
    ),
    ("async function h() {}", BuiltinId::PromiseAll),
    ("f.then(g);", BuiltinId::PromiseAll),
    ("f.try(g);", BuiltinId::PromiseAll),
    ("f.constructor.name;", BuiltinId::PromiseAll),
    ("export const awaited = await f;", BuiltinId::PromiseAll),
    ("import(f);", BuiltinId::PromiseAll),
    (
        "{ using held = f; }",
        BuiltinId::DisposableStackPrototypeDispose,
    ),
];

fn answer(uses: &RuntimeUses) -> RuntimeUses {
    match uses.asks == AsksOfText::default() {
        true => uses.clone(),
        false => RuntimeUses::of_asks(&uses.asks, Platforms::LINUX),
    }
}

fn holds_code_of(uses: &RuntimeUses, id: BuiltinId) -> bool {
    let mut own = table::entry(id).implemented_by().iter();
    assert!(own.len() > 0, "{}", table::text_of(id));
    own.all(|function| uses.functions.contains(function))
}

#[test]
fn a_name_off_a_value_that_no_binding_stands_for_asks_for_the_members_of_that_name() {
    for setup in [PROGRAM, RUNTIME] {
        for &(source, member) in SPELL_WHAT_NO_BINDING_STANDS_FOR {
            with_case(setup, source, |case| {
                let uses = answer(case.resolved.uses());
                assert!(holds_code_of(&uses, member), "{source}");
                assert!(
                    !holds_code_of(&uses, BuiltinId::ArrayPrototypeFlatMap),
                    "{source}"
                );
                assert!(!case.resolved.uses().lets_in_what_nobody_names, "{source}");
            });
        }
    }
}

const ASK_NOTHING: &[&str] = &[
    "f.made_up_name();",
    "f.get(g);",
    "f[0];",
    "f[-1];",
    "f[g.length - 1];",
    "f[g % 3];",
    "f[g >>> h];",
    "f[+g];",
    "f[g | 0];",
    "for (let i = 0; i < 3; i++) f[i];",
    "let i = 0; i += 2; i = i * 2 + 1; f[i];",
    "var i = 0; var i = 1; f[i++];",
];

const KEYS_THAT_NOBODY_KNOWS: &[&str] = &[
    "f[key];",
    "for (const k in f) g(f[k]);",
    "for (const k in f) g[k]();",
    "let k; for (k in f) g(f[k]);",
    "f[names[0]];",
    "const { [key]: taken } = f;",
    "const { [+g]: taken } = f;",
    "let i = 0; i++; const { [i]: taken } = f;",
    "let i = 0; i++; let taken; ({ [i]: taken } = f);",
    "var steps = Symbol.iterator; f[steps];",
    "var steps = Symbol.iterator; const again = steps; f[again];",
    "let i = 0; i = g(); f[i];",
    "let i = 0, j = g(); i = j + 1; j = i + 1; f[i];",
    "for (var k = 0 in g) f[k];",
    "function h(k = g) { var k; f[k]; }",
    "function h(k = 0) { var k; var k = g; f[k]; }",
    "namespace N { export let i = 0; f[i]; }",
    "let i = 0; i += g(); f[i];",
    "let i = 0; [i] = g; f[i];",
    "function h(i) { f[i]; }",
    "for (const k in f) f[k + k];",
    "let k = 'a'; for (k in f) f[k];",
    "let k; for (k in f); k = g(); f[k];",
    "for (const k of g) f[k];",
    "f[typeof g];",
    "Reflect.get(f, g);",
    "Object.getOwnPropertyDescriptor(f, g);",
    "f.getOwnPropertyDescriptors(g);",
];

#[test]
fn what_the_text_of_a_program_asks_is_kept_and_what_a_text_of_the_library_asks_is_answered() {
    for source in [
        "f.sort();",
        "JSON.stringify(f);",
        "for (const item of f) g(item);",
    ] {
        with_case(PROGRAM, source, |case| {
            let uses = case.resolved.uses();
            assert!(uses.functions.is_empty(), "{source}");
            assert_ne!(uses.asks, AsksOfText::default(), "{source}");
            assert!(answer(uses).modules.is_empty(), "{source}");
        });
    }
    for source in ["f.sort();", "for (const item of f) g(item);"] {
        with_case(RUNTIME, source, |case| {
            let uses = case.resolved.uses();
            assert!(!uses.functions.is_empty(), "{source}");
            assert_eq!(uses.asks, AsksOfText::default(), "{source}");
        });
    }
}

const KEYS_THAT_MAY_BE_BIG_NUMBERS: &[&str] = &[
    "f[g % h];",
    "f[g * h];",
    "f[g >> h];",
    "f[-g];",
    "f[~g];",
    "f[1n];",
];

#[test]
fn a_key_that_may_be_a_big_number_is_one_that_nobody_knows_in_the_text_of_a_program() {
    for source in KEYS_THAT_MAY_BE_BIG_NUMBERS {
        with_case(PROGRAM, source, |case| {
            assert!(case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert_eq!(*case.resolved.uses(), RuntimeUses::default(), "{source}");
        });
    }
}

const TEXTS_UNDER_WHICH_AN_EVALUATOR_HANGS: &[&str] = &[
    "f('constructor');",
    "const a = 'constructor';",
    "f(`constructor`);",
    "f('con' + 'structor');",
    "a === 'constructor';",
    "f(`constructor${a}`);",
    "f(`${a}constructor`);",
    "f(`${a}constructor${b}`);",
    "f(['a', 'constructor', 'b'].join('.'));",
    "const words = ['constructor', 'length'];",
    "({ constructor: 1 });",
    "f({ 'constructor': a });",
    "f({ constructor() {} });",
    "f(function constructor() {});",
    "function constructor() {}",
    "f(class constructor {});",
    "class constructor {}",
    "class A { static constructor() {} }",
    "const constructor = () => {};",
    "function g(constructor = () => {}) {}",
    "constructor = function () {};",
    "switch (a) { case 'constructor': }",
    "enum Part { constructor }",
];

#[test]
fn a_text_that_a_program_spells_and_under_which_an_evaluator_hangs_is_a_name_read() {
    for source in TEXTS_UNDER_WHICH_AN_EVALUATOR_HANGS {
        with_case(PROGRAM, source, |case| {
            let asks = &case.resolved.uses().asks;
            let held = RuntimeUses::of_asks(asks, Platforms::LINUX);
            assert!(holds_code_of(&held, BuiltinId::Promise), "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert_eq!(*case.resolved.uses(), RuntimeUses::default(), "{source}");
        });
    }
    for source in ["f('flatMap');", "f('then');", "({ eval: 1 });"] {
        with_case(PROGRAM, source, |case| {
            let expected = uses_of_text_that_only_may_hand_values_to_natives();
            assert_eq!(*case.resolved.uses(), expected, "{source}");
        });
    }
}

#[test]
fn the_constructor_of_a_class_spells_no_name_under_which_an_evaluator_hangs() {
    for source in [
        "class A { constructor() {} }",
        "f(class { 'constructor'() {} });",
    ] {
        with_case(PROGRAM, source, |case| {
            let asks = &case.resolved.uses().asks;
            assert!(asks.members_read.is_empty(), "{source}");
        });
    }
}

#[test]
fn one_name_under_which_text_is_evaluated_off_the_global_object_brings_code_of_the_language() {
    use crate::builtins::runtime_uses::is_name_of_language_member_with_code;
    let flags_of = |id: BuiltinId| table::entry(id).flags;
    let mut names: Vec<&[u8]> = Vec::new();
    for id in BuiltinId::ALL {
        let entry = table::entry(id);
        let is_global = |holder| flags_of(holder).contains(table::BuiltinFlags::IS_GLOBAL_OBJECT);
        if flags_of(table::canonical_id(id)).contains(table::BuiltinFlags::EVALUATES_TEXT)
            && entry.holder.is_some_and(|holder| !is_global(holder))
            && is_name_of_language_member_with_code(entry.name)
        {
            names.push(table::text_of_name(entry.name));
        }
    }
    names.sort_unstable();
    names.dedup();
    assert_eq!(names, [b"constructor".as_slice()]);
}

#[test]
fn one_text_under_which_an_evaluator_hangs_brings_code_of_the_language() {
    use crate::builtins::runtime_uses::{
        is_name_of_language_member_with_code, is_name_under_which_evaluator_hangs,
    };
    let names = BuiltinId::ALL.into_iter().map(|id| table::entry(id).name);
    let names = names.filter(|&name| is_name_under_which_evaluator_hangs(name));
    let names = names.filter(|&name| is_name_of_language_member_with_code(name));
    let mut names: Vec<&[u8]> = names.map(table::text_of_name).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names, [b"constructor".as_slice()]);
}

#[test]
fn a_text_that_is_not_asked_names_the_entries_that_it_names_when_it_is_asked() {
    const NOT_ASKED: Setup = Setup {
        is_text_asked: false,
        ..PROGRAM
    };
    for source in [
        "[1].flatMap(f); Promise.all([]);",
        "Array.from(f); g.then(h); for (const a of b) {}",
        "process.nextTick(f); g[h];",
    ] {
        let asked = with_case(PROGRAM, source, |case| case.resolved.uses().clone());
        let not_asked = with_case(NOT_ASKED, source, |case| case.resolved.uses().clone());
        assert_eq!(asked.functions, not_asked.functions, "{source}");
        assert_eq!(asked.modules, not_asked.modules, "{source}");
        assert_eq!(asked.exports_read, not_asked.exports_read, "{source}");
        let AsksOfText {
            members_read,
            reads_by_unknown_key,
            syntax,
            may_hand_values_to_natives: _,
        } = not_asked.asks;
        assert!(
            members_read.is_empty() && !reads_by_unknown_key && syntax.is_empty(),
            "{source}"
        );
    }
}

#[test]
fn a_key_that_is_a_number_asks_nothing() {
    for source in ASK_NOTHING {
        with_case(PROGRAM, source, |case| {
            let expected = uses_of_text_that_only_may_hand_values_to_natives();
            assert_eq!(*case.resolved.uses(), expected, "{source}");
        });
        with_case(RUNTIME, source, |case| {
            assert_eq!(*case.resolved.uses(), RuntimeUses::default(), "{source}");
        });
    }
}

const ONLY_CALL_BUILT_INS_WITH_WRITTEN_PRIMITIVES: &[&str] = &[
    "",
    "console.log(1);",
    "console.log('a', 2, true, false, null);",
    "console.log('a'); console.table('b');",
    "console['log'](1);",
    "if (console.log('a')) console.log('b');",
    "while (false) console.log('a');",
    "let a = 1; const b = 'b';",
    "class A {}",
    "throw 'a';",
];

const MAY_HAND_A_VALUE_TO_A_NATIVE: &[&str] = &[
    "console.log(a);",
    "function h(console) { console.log(1); }",
    "console.log([1]);",
    "console.log({ a: 1 });",
    "console.log(() => {});",
    "console.log(String(f));",
    "console.log(process.title);",
    "console.log(console.log);",
    "console.log(Math);",
    "console.log(...a);",
    "const log = console.log; log(1);",
    "const a = setTimeout(() => {}, 1);",
    "new Map();",
    "f(1);",
    "a.b(1);",
    "'a'.at(0);",
    "console.log`a`;",
    "console.log(this);",
];

#[test]
fn a_text_that_only_calls_built_ins_with_written_primitives_asks_nothing_of_any_operand() {
    for source in ONLY_CALL_BUILT_INS_WITH_WRITTEN_PRIMITIVES {
        with_case(PROGRAM, source, |case| {
            assert_eq!(*case.resolved.uses(), RuntimeUses::default(), "{source}");
        });
    }
    for source in MAY_HAND_A_VALUE_TO_A_NATIVE {
        with_case(PROGRAM, source, |case| {
            let uses = case.resolved.uses();
            let is_loud = uses.asks.may_hand_values_to_natives || uses.lets_in_what_nobody_names;
            assert!(is_loud, "{source}");
        });
    }
}

#[test]
fn a_key_that_nobody_knows_lets_in_what_nobody_names_and_in_the_library_asks_for_the_language() {
    for source in KEYS_THAT_NOBODY_KNOWS {
        with_case(PROGRAM, source, |case| {
            assert!(case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
        with_case(RUNTIME, source, |case| {
            let uses = case.resolved.uses();
            for member in [BuiltinId::ArrayPrototypeFlatMap, BuiltinId::PromiseAll] {
                assert!(holds_code_of(uses, member), "{source}");
            }
            assert!(!uses.lets_in_what_nobody_names, "{source}");
        });
    }
}

#[test]
fn what_any_operand_may_be_asked_for_is_held_where_a_value_may_reach_native_code() {
    let of_quiet_texts = RuntimeUses::of_asks(&AsksOfText::default(), Platforms::LINUX);
    assert_eq!(of_quiet_texts, RuntimeUses::default());
    let asks = uses_of_text_that_only_may_hand_values_to_natives().asks;
    let held = RuntimeUses::of_asks(&asks, Platforms::LINUX);
    for member in [
        BuiltinId::ArrayIteratorPrototypeNext,
        BuiltinId::GeneratorPrototypeNext,
        BuiltinId::GeneratorPrototypeReturn,
        BuiltinId::GeneratorPrototypeThrow,
        BuiltinId::DisposableStackPrototypeDispose,
    ] {
        assert!(holds_code_of(&held, member), "{}", table::text_of(member));
    }
    assert!(!holds_code_of(&held, BuiltinId::ArrayPrototypeFlatMap));
    assert!(!holds_code_of(&held, BuiltinId::PromiseAll));
    assert!(held.modules.is_empty());
}

#[test]
fn what_any_operand_is_asked_for_makes_no_promise() {
    let found = table::FUNCTIONS_FOUND_ON_ANY_OPERAND;
    assert!(!found.is_empty());
    let prototypes = table::PROTOTYPES_THAT_COME_WITH_FIRST_PROMISE;
    assert!(prototypes.contains(&BuiltinId::PromisePrototype));
    let mut asked = 0;
    for member in BuiltinId::ALL {
        let entry = table::entry(member);
        let own = entry.implemented_by();
        if own.is_empty()
            || !entry
                .holder
                .is_some_and(|holder| prototypes.contains(&holder))
        {
            continue;
        }
        asked += 1;
        let mut own = own.iter();
        assert!(
            !own.all(|function| found.contains(function)),
            "{}",
            table::text_of(member)
        );
    }
    assert!(asked > 10, "{asked}");
}

const ARE_QUIET_BY_SYNTAX_AND_BRING_CODE_OR_EXPOSE: &[&str] = &[
    "Promise.resolve(1);",
    "Array.from('ab');",
    "Object.keys('ab');",
    "process.allowedNodeEnvironmentFlags;",
];

#[test]
fn a_text_that_is_quiet_by_its_syntax_and_brings_code_of_the_library_may_hand_values_to_natives() {
    for source in ARE_QUIET_BY_SYNTAX_AND_BRING_CODE_OR_EXPOSE {
        with_case(PROGRAM, source, |case| {
            let uses = case.resolved.uses();
            let is_loud = uses.asks.may_hand_values_to_natives || uses.lets_in_what_nobody_names;
            assert!(is_loud, "{source}");
        });
    }
}

#[test]
fn a_program_that_may_evaluate_text_or_lay_a_method_for_the_printer_says_so() {
    let lets_in = |setup: Setup, source: &str| {
        with_case(setup, source, |case| {
            case.resolved.uses().lets_in_what_nobody_names
        })
    };
    for source in [
        "eval(f);",
        "new Function(f);",
        "f.constructor('return 1');",
        "new f.constructor();",
        "const made = f.constructor;",
        "const { constructor } = f;",
        "const made = f['constructor'];",
        "const key = 'constructor'; f[key]('return 1');",
        "const key = 'constructor'; const { [key]: made } = f;",
        "const key = 'constructor'; let made; ({ [key]: made } = f);",
        "g(f.constructor);",
        "Symbol.for('nodejs.util.inspect.custom');",
        "Symbol.for(f);",
        "Reflect.has(f, 'a');",
        "f.for('nodejs.util.inspect.custom');",
        "const register = f.constructor.for;",
        "const made = (f.constructor ||= null);",
        "g(Symbol.for);",
        "g(Symbol);",
        "Symbol[f];",
        "Reflect.get(Symbol, 'for');",
        "Object.getOwnPropertyDescriptor(Symbol, 'for');",
        "class Kind extends Symbol {}",
        "Bun.inspect.custom;",
        "Buffer;",
    ] {
        assert!(lets_in(PROGRAM, source), "{source}");
        assert!(!lets_in(RUNTIME, source), "{source}");
    }
    for source in [
        "f.constructor.name;",
        "f.constructor === g;",
        "f['constructor'] === g;",
        "typeof f.constructor;",
        "Symbol.for('a made-up text');",
        "Symbol.iterator;",
        "JSON.stringify(f);",
        "f.constructor = g;",
        "Symbol('a made-up text');",
        "typeof Symbol;",
        "f instanceof Symbol;",
        "console.log(f);",
    ] {
        assert!(!lets_in(PROGRAM, source), "{source}");
    }
}

#[test]
fn a_variable_that_the_function_of_a_block_is_stored_into_is_a_key_that_nobody_knows() {
    for source in [
        "var i = 0; { function i() {} } f[i];",
        "var i = 0; if (g) function i() {} f[i];",
        "function h() { var i = 0; { function i() {} } return f[i]; }",
        "var i = 0; { function i() {} } const j = i; f[j];",
    ] {
        with_case(SCRIPT, source, |case| {
            assert!(case.resolved.uses().lets_in_what_nobody_names, "{source}");
        });
    }
}

#[test]
fn the_names_behind_the_first_of_a_path_written_for_jsx_are_names_that_the_text_reads() {
    const ELEMENTS: Setup = Setup {
        path: "/project/a.tsx",
        ..PROGRAM
    };
    for (source, is_read) in [
        (
            "/** @jsxRuntime classic */\n/** @jsx list.at */\nconst list = [1]; <a />;",
            true,
        ),
        (
            "/** @jsxRuntime classic */\n/** @jsx make */\n/** @jsxFrag list.at */\nconst list = [1]; <></>;",
            true,
        ),
        (
            "/** @jsxRuntime classic */\n/** @jsx list.at */\nconst list = [1];",
            false,
        ),
    ] {
        with_case(ELEMENTS, source, |case| {
            let members_read = &case.resolved.uses().asks.members_read;
            assert_eq!(!members_read.is_empty(), is_read, "{source}");
        });
    }
}
