use super::*;
use crate::builtins::{AsksOfText, RuntimeUses};

const SPELL_WHAT_NO_BINDING_STANDS_FOR: &[(&str, BuiltinId)] = &[
    ("f.sort();", BuiltinId::ArrayPrototypeSort),
    ("f?.sort();", BuiltinId::ArrayPrototypeSort),
    ("f['call'];", BuiltinId::FunctionPrototypeCall),
    ("f[Symbol.iterator];", BuiltinId::ArrayIteratorPrototypeNext),
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
    for source in ["f('flatMap');", "f('then');", "({ constructor: 1 });"] {
        with_case(PROGRAM, source, |case| {
            assert_eq!(*case.resolved.uses(), RuntimeUses::default(), "{source}");
        });
    }
}

#[test]
fn a_key_that_is_a_number_asks_nothing() {
    for setup in [PROGRAM, RUNTIME] {
        for source in ASK_NOTHING {
            with_case(setup, source, |case| {
                assert_eq!(*case.resolved.uses(), RuntimeUses::default(), "{source}");
            });
        }
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
fn what_any_operand_may_be_asked_for_is_held_whatever_the_texts_ask() {
    let held = RuntimeUses::of_asks(&AsksOfText::default(), Platforms::LINUX);
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
    let called_for_promise = table::entry(BuiltinId::Promise).calls();
    let mut found = table::FUNCTIONS_FOUND_ON_ANY_OPERAND.iter();
    assert!(found.len() > 0);
    assert!(found.all(|function| !called_for_promise.contains(function)));
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
