//! What the optimizing compiler concludes about values.

mod support;

use std::rc::Rc;

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_runtime::{Bits, Options, Tiering, optimize_fully};
use support::link::Item;
use support::machine::{Failure, Machine};
use support::{engine, options, with_machine};

fn in_both_tiers(test: impl Fn(&Machine) + Sync) {
    for tiering in [Tiering::BaselineOnly, Tiering::OptimizedOnly] {
        for handle_faults in [true, false] {
            let options = Options {
                tiering,
                handle_faults,
                guard_memories: handle_faults,
                optimizer: optimize_fully,
                ..options()
            };
            with_machine(engine(options), &test);
        }
    }
}

const TYPES: &str = "
    (type $base (sub (struct (field i32))))
    (type $middle (sub $base (struct (field i32) (field i32))))
    (type $leaf (sub $middle (struct (field i32) (field i32))))
    (type $list (sub (array i32))) (type $sublist (sub $list (array i32)))
    (type $make (sub (func (result (ref null $base)))))
    (type $make_middle (sub $make (func (result (ref null $middle)))))
    (func $base (type $make) (struct.new $base (i32.const 1)))
    (func $middle (type $make_middle) (struct.new $middle (i32.const 1) (i32.const 2)))
    (elem declare func $base $middle)";

/// The local keeps its value.
fn loop_and_merge(local: &str) -> String {
    format!(
        "(loop (local.set {local} (local.get {local})) (br_if 0 (i32.eq (local.get $n) (i32.const 9))))
        (if (local.get $n) (then (local.set {local} (local.get {local}))))"
    )
}

#[test]
fn a_value_has_its_type_in_a_local_of_any_type() {
    let objects = ["any", "eq", "i31", "struct", "array", "none"];
    let structs = ["$base", "$middle", "$leaf"];
    let (lists, functions) = (["$list", "$sublist"], ["func", "$make", "$make_middle"]);
    let below_any: Vec<_> = (objects.iter().chain(&structs).chain(&lists)).collect();
    let cases = [
        (
            "(struct.new $middle (i32.const 1) (i32.const 2))",
            "any eq struct $base $middle",
        ),
        (
            "(array.new_default $list (local.get $n))",
            "any eq array $list",
        ),
        (
            "(array.new_fixed $sublist 0)",
            "any eq array $list $sublist",
        ),
        ("(ref.i31 (i32.const 5))", "any eq i31"),
        ("(ref.func $base)", "func $make"),
        ("(ref.func $middle)", "func $make $make_middle"),
    ];
    in_both_tiers(|machine| {
        for (value, supertypes) in cases {
            let targets = match supertypes.starts_with("func") {
                true => functions.iter().collect(),
                false => below_any.clone(),
            };
            for (declared, to) in (supertypes.split_ascii_whitespace())
                .flat_map(|declared| targets.iter().map(move |to| (declared, to)))
            {
                let start = format!(
                    "(param $n i32) (result i32) (local $x (ref null {declared}))
                    (local.set $x {value}) {}",
                    loop_and_merge("$x")
                );
                let source = format!(
                    r#"{TYPES}
                    (func (export "test") {start} (ref.test (ref {to}) (local.get $x)))
                    (func (export "test null") {start} (ref.test (ref null {to}) (local.get $x)))
                    (func (export "cast") {start}
                        (i32.eqz (ref.is_null (ref.cast (ref null {to}) (local.get $x)))))"#
                );
                let instance = machine.load(&source, &[]);
                let holds = supertypes.split_ascii_whitespace().any(|it| it == **to);
                let cast = holds.then_some(vec![1]);
                for n in [0, 1] {
                    let call = |name| machine.invoke(instance, name, &[n]);
                    assert_eq!(
                        call("test"),
                        Ok(vec![holds.into()]),
                        "{value} {declared} {to}"
                    );
                    assert_eq!(call("test null"), call("test"));
                    assert_eq!(call("cast").ok(), cast, "{value} {declared} {to}");
                }
            }
        }
    });
}

#[test]
fn a_local_keeps_the_type_that_it_is_declared_with() {
    let source = format!(
        r#"{TYPES}
        (func (export "f") (param $n i32) (result i32)
            (local $x (ref null $middle)) (local $y (ref null $base))
            (local.set $y (local.tee $x (call $middle)))
            {}
            (drop (ref.as_non_null (block (result (ref null $base))
                (drop (br_if 0 (local.get $x) (local.get $n)))
                (local.get $y))))
            (struct.get $middle 1 (local.get $x)))"#,
        loop_and_merge("$y")
    );
    in_both_tiers(|machine| {
        let instance = machine.load(&source, &[]);
        for n in [0, 1] {
            assert_eq!(machine.invoke(instance, "f", &[n]), Ok(vec![2]));
        }
    });
}

#[test]
fn what_a_test_tells_holds_on_one_way() {
    let start = "(param $n i32) (result i32) (local $x (ref null $base))
        (local.set $x (call $pick (local.get $n)))";
    let (test, cast) = (
        "(ref.test (ref $middle) (local.get $x))",
        "(struct.get $middle 1 (ref.cast (ref null $middle) (local.get $x)))",
    );
    let source = format!(
        r#"{TYPES}
        (global $base (mut (ref null $base)) (struct.new $base (i32.const 1)))
        (func $pick (param i32) (result (ref null $base))
            (if (result (ref null $base)) (local.get 0)
                (then (global.get $base)) (else (ref.null $base))))
        (func (export "br_if") {start} (drop (br_if 0 (i32.const 9) {test})) {cast})
        (func (export "if") {start}
            (if (result i32) (i32.eqz {test}) (then {cast}) (else (i32.const 9))))
        (func (export "if null") {start}
            (if (result i32) (ref.is_null (local.get $x))
                (then (ref.is_null (local.get $x))) (else (i32.const 9))))
        (func (export "br_on_non_null") {start}
            (struct.get $base 0 (block (result (ref $base))
                (br_on_non_null 0 (local.get $x))
                (return (ref.is_null (local.get $x))))))"#
    );
    in_both_tiers(|machine| {
        let instance = machine.load(&source, &[]);
        let call = |name, n| machine.invoke(instance, name, &[n]);
        for name in ["br_if", "if"] {
            assert_eq!(call(name, 1), Err(Failure::Trap(Trap::CastFailure)));
            assert_eq!(call(name, 0), Err(Failure::Trap(Trap::NullReference)));
        }
        assert_eq!(
            [0, 1].map(|n| call("if null", n)),
            [Ok(vec![1]), Ok(vec![9])]
        );
        assert_eq!(call("br_on_non_null", 0), Ok(vec![1]));
    });
}

#[test]
fn every_kind_of_branch_tells_each_way_its_own() {
    let types = ["null $base", "$base", "null $middle", "$middle", "$leaf"];
    // A bit for each of the types that it has, by the argument of `$make`.
    let has = [0b00101, 0b00011, 0b01111, 0b11111];
    let tests = (types.iter().zip(0..)).map(|(ty, bit)| {
        format!("(i32.shl (ref.test (ref {ty}) (local.get $x)) (i32.const {bit})) i32.or ")
    });
    let seen = format!(
        "(i32.shl (ref.is_null (local.get $x)) (i32.const 5)) {}",
        tests.collect::<String>()
    );
    let (taken, other) = (
        format!("(local.set $way (i32.add (i32.const 64) {seen}))"),
        format!("(local.set $way {seen})"),
    );
    let on_condition = |condition: &str| {
        [
            format!("(block (block (br_if 0 {condition}) {other} (br 1)) {taken})"),
            format!("(block (block (br_if 0 (i32.eqz {condition})) {taken} (br 1)) {other})"),
            format!("(if {condition} (then {taken}) (else {other}))"),
            format!("(if (i32.eqz {condition}) (then {other}) (else {taken}))"),
            format!("{other} (if {condition} (then {taken}))"),
        ]
    };
    let with_value = |branch: &str, [next, target]: [&str; 2]| {
        format!("(block (drop (block (result (ref null $base)) {branch} {next} (br 1))) {target})")
    };
    let mut cases: Vec<(String, usize, bool)> = Vec::new();
    for (bit, ty) in types.iter().enumerate() {
        let condition = format!("(ref.test (ref {ty}) (local.get $x))");
        cases.extend(on_condition(&condition).map(|code| (code, bit, true)));
        for (name, ways) in [("", [&other, &taken]), ("_fail", [&taken, &other])] {
            let branch =
                format!("(drop (br_on_cast{name} 0 (ref null $base) (ref {ty}) (local.get $x)))");
            cases.push((with_value(&branch, ways.map(|it| &**it)), bit, true));
        }
    }
    cases.extend(on_condition("(ref.is_null (local.get $x))").map(|code| (code, 1, false)));
    let on_null =
        format!("(block (block (drop (br_on_null 0 (local.get $x))) {other} (br 1)) {taken})");
    let on_non_null = with_value("(br_on_non_null 0 (local.get $x))", [&other, &taken]);
    cases.extend([(on_null, 1, false), (on_non_null, 1, true)]);
    in_both_tiers(|machine| {
        for (code, bit, is_taken_if_set) in &cases {
            let source = format!(
                r#"{TYPES}
                (func $make (param $n i32) (result (ref null $base))
                    (block (block (block (block (br_table 0 1 2 3 (local.get $n)))
                        (return (ref.null $base)))
                        (return (call $base)))
                        (return (call $middle)))
                    (struct.new $leaf (i32.const 1) (i32.const 2)))
                (func (export "f") (param $n i32) (result i32 i32)
                    (local $x (ref null $base)) (local $way i32)
                    (local.set $x (call $make (local.get $n)))
                    {code}
                    (local.get $way)
                    {seen})"#
            );
            let instance = machine.load(&source, &[]);
            for (n, has) in (0..).zip(has) {
                let seen = has | Bits::from(n == 0) << 5;
                let is_taken = (has >> bit & 1 != 0) == *is_taken_if_set;
                let expected = vec![seen | Bits::from(is_taken) << 6, seen];
                assert_eq!(
                    machine.invoke(instance, "f", &[n]),
                    Ok(expected),
                    "{code} {n}"
                );
            }
        }
    });
}

#[test]
fn a_branch_carries_the_values_that_were_pushed_for_it() {
    let count = 10;
    let types = "i32 ".repeat(count);
    let pushed = "(local.get $a) ".repeat(count);
    let source = format!(
        r#"(func (export "f") (param $n i32) (result i32) (local $a i32) (local $b i32)
            (local.set $a (i32.const 1))
            {pushed}
            (block (param {types}) (result {types})
                (local.set $a (i32.const 100))
                (br_if 0 (i32.eq (local.get $n) (i32.const 1)))
                (local.set $b (local.get $a))
                (local.set $a (i32.const 200))
                (br_if 0 (i32.eq (local.get $n) (i32.const 2)))
                (block (param {types}) (result {types})
                    (local.set $a (i32.const 300))
                    (br_if 1 (i32.eq (local.get $n) (i32.const 3)))
                    (br_if 0 (i32.eq (local.get $n) (i32.const 4))))
                (local.set $a (i32.const 400)))
            {sums}
            (i32.add (local.get $a) (i32.mul (local.get $b) (i32.const 1000)))
            (i32.add))"#,
        sums = "(i32.add) ".repeat(count - 1)
    );
    in_both_tiers(|machine| {
        let instance = machine.load(&source, &[]);
        for (n, rest) in [
            (0, 100_400),
            (1, 100),
            (2, 100_200),
            (3, 100_300),
            (4, 100_400),
        ] {
            let expected = count as Bits + rest as Bits;
            assert_eq!(machine.invoke(instance, "f", &[n]), Ok(vec![expected]));
        }
    });
}

#[test]
fn a_known_function_is_called_with_the_type_of_the_call() {
    let source = format!(
        r#"(import "" "make" (func $imported (type $make))) {TYPES} (elem declare func $imported)
        (func (export "defined") (result i32)
            (struct.get $middle 1 (call_ref $make_middle (ref.cast (ref $make_middle) (ref.func $base)))))
        (func (export "imported") (result i32)
            (struct.get $middle 1 (call_ref $make_middle (ref.cast (ref $make_middle) (ref.func $imported)))))"#
    );
    in_both_tiers(|machine| {
        let provider = machine.load(&format!(r#"{TYPES} (export "f" (func $middle))"#), &[]);
        let make = support::link::export(provider, b"f").unwrap();
        let instance = machine.load(&source, &[("make", &make)]);
        let failure = Err(Failure::Trap(Trap::CastFailure));
        assert_eq!(machine.invoke(instance, "defined", &[]), failure);
        assert_eq!(machine.invoke(instance, "imported", &[]), Ok(vec![2]));
    });
}

#[test]
fn a_comparison_can_be_a_length_and_a_condition() {
    let source = r#"(type $a (array (mut i8))) (global $a (mut (ref null $a)) (ref.null $a))
        (func (export "f") (param i32 i32) (result i32 i32) (local (ref null $a))
            (block (result i32)
                (drop (br_if 0 (i32.const 1) (array.len (call $keep
                    (array.new_default $a (i32.lt_s (local.get 0) (local.get 1)))))))
                (i32.const 0))
            (array.len (global.get $a)))
        (func $keep (param (ref $a)) (result (ref $a)) (global.set $a (local.get 0)) (local.get 0))
        (data $empty "")
        (func (export "g") (param i32 i32) (result i32)
            (block
                (br_if 0 (array.len (array.new_data $a $empty
                    (i32.const 0) (i32.lt_s (local.get 0) (local.get 1)))))
                (return (i32.const 0)))
            (i32.const 1))"#;
    in_both_tiers(|machine| {
        let instance = machine.load(source, &[]);
        let call = |name, arguments: [Bits; 2]| machine.invoke(instance, name, &arguments);
        assert_eq!(call("f", [1, 2]), Ok(vec![1, 1]));
        assert_eq!(call("f", [2, 1]), Ok(vec![0, 0]));
        assert_eq!(call("g", [2, 1]), Ok(vec![0]));
        let failure = Failure::Trap(Trap::ArrayNewDataFailure);
        assert_eq!(call("g", [1, 2]), Err(failure));
    });
}

/// A function that collects, which nothing else does.
fn collector(machine: &Machine) -> Item {
    #[inline(never)]
    fn clear_dead_stack() {
        std::hint::black_box([0u8; 16 << 10]);
    }
    machine.collect_every(u32::MAX);
    machine.host_function(
        None,
        Rc::new(|machine, _, _| {
            clear_dead_stack();
            machine.collect(true);
            Ok(vec![])
        }),
    )
}

#[test]
fn an_array_lives_as_long_as_its_elements_are_used() {
    let index = "(i32.sub (local.get $biased) (i32.const 0x40000))";
    let uses = [
        format!("(array.get $a (local.get $a) {index})"),
        format!(
            "(array.set $a (local.get $a) {index} (i64.const 7)) (array.get $a (local.get $a) {index})"
        ),
        format!(
            "(array.copy $a $a (global.get $b) (i32.const 0) (local.get $a) {index} (i32.const 1))
            (array.get $a (global.get $b) (i32.const 0))"
        ),
    ];
    in_both_tiers(|machine| {
        let collect = collector(machine);
        for usage in &uses {
            let source = format!(
                r#"(type $a (array (mut i64))) (import "" "collect" (func $collect))
                (global $b (ref $a) (array.new_default $a (i32.const 1)))
                (func (export "sum") (param $i i32) (param $turns i32) (result i64)
                    (local $a (ref null $a)) (local $biased i32) (local $sum i64)
                    (local.set $biased
                        (i32.and (i32.or (local.get $i) (i32.const 0x40000)) (i32.const 0x40007)))
                    (local.set $a (array.new $a (i64.const 7) (i32.const 40)))
                    (loop
                        (call $collect)
                        (local.set $sum (i64.add (local.get $sum) (block (result i64) {usage})))
                        (br_if 0 (local.tee $turns (i32.sub (local.get $turns) (i32.const 1)))))
                    (local.get $sum))"#
            );
            let instance = machine.load(&source, &[("collect", &collect)]);
            assert_eq!(machine.invoke(instance, "sum", &[3, 4]), Ok(vec![28]));
        }
    });
}

#[test]
fn elements_of_a_new_array_are_read_before_it_is_dropped() {
    const COUNT: u32 = 10;
    let each = |line: fn(u32) -> String| (0..COUNT).map(line).collect::<String>();
    let source = format!(
        r#"(type $a (array i32)) (import "" "collect" (func $collect))
        (global $wanted (mut i32) (i32.const 1))
        (func (export "sum") (param $i i32) (result i32)
            (local $a (ref null $a)) (local $biased i32) {}
            (local.set $biased
                (i32.and (i32.or (local.get $i) (i32.const 0x40000)) (i32.const 0x40007)))
            (local.set $a (array.new $a (i32.const 7) (i32.const 40)))
            {}
            (call $collect)
            (if (result i32) (global.get $wanted) (then (i32.const 0) {}) (else (i32.const 0))))"#,
        each(|n| format!("(local $v{n} i32) ")),
        each(|n| format!(
            "(local.set $v{n} (array.get $a (local.get $a)
                (i32.sub (local.get $biased) (i32.const {}))))",
            0x40000 - n
        )),
        each(|n| format!("(local.get $v{n}) i32.add ")),
    );
    in_both_tiers(|machine| {
        let instance = machine.load(&source, &[("collect", &collector(machine))]);
        let sum = machine.invoke(instance, "sum", &[3]);
        assert_eq!(sum, Ok(vec![(7 * COUNT).into()]));
    });
}
