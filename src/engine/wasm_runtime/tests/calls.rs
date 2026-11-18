#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::cell::{Cell, RefCell};
use std::fmt::Write;
use std::rc::Rc;

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_runtime::{
    Bits, HostCell, Options, Outcome, Reference, Tiering, optimize_fully,
};
use support::link::{Item, export};
use support::machine::{Failure, Machine, spoil_registers};
use support::{engine, for_each_mode, options, with_machine};

const TYPES: [(&str, u32); 6] = [
    ("i32", 32),
    ("i64", 64),
    ("f32", 32),
    ("f64", 64),
    ("v128", 128),
    ("i31ref", 31),
];

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn types(&mut self, most: u64) -> Vec<(&'static str, u32)> {
        let kinds = 1 + self.next() % 6;
        let first = self.next();
        let count = self.next() % (most + 1);
        (0..count)
            .map(|_| TYPES[((first + self.next() % kinds) % 6) as usize])
            .collect()
    }

    fn values(&mut self, types: &[(&str, u32)]) -> Vec<Bits> {
        let value = |&(_, bits): &(&str, u32)| match bits {
            31 => Reference::from_i31(self.next() as i32).into(),
            _ => (Bits::from(self.next()) << 64 | Bits::from(self.next())) >> (128 - bits),
        };
        types.iter().map(value).collect()
    }
}

fn names(types: &[(&str, u32)]) -> String {
    types.iter().map(|ty| ty.0).collect::<Vec<_>>().join(" ")
}

/// In through an export, the first time through the stub that compiles, and out through an import.
#[test]
fn values_of_all_types_pass_both_ways() {
    let spoiling = engine(Options {
        tiering: Tiering::OptimizedOnly,
        optimizer: |_, _, _, _, _| {
            spoil_registers();
            None
        },
        ..options()
    });
    with_machine(spoiling, |machine| {
        let mut random = Random(7);
        for _ in 0..150 {
            let (params, results) = (random.types(24), random.types(8));
            let ty = format!("(param {}) (result {})", names(&params), names(&results));
            let forward = (0..params.len()).fold(String::new(), |mut text, index| {
                write!(text, "local.get {index} ").unwrap();
                text
            });
            let source = format!(
                r#"(import "" "host" (func $host {ty}))
                (export "again" (func $host))
                (table 1 funcref) (elem (i32.const 0) func $host)
                (func $call (export "call") {ty} {forward} call $host)
                (func (export "twice") {ty} {forward} call $call)
                (func (export "tail") {ty} {forward} return_call $host)
                (func (export "indirect") {ty} {forward} i32.const 0 call_indirect {ty})"#
            );
            let (arguments, returned) = (random.values(&params), random.values(&results));
            let (expected, answer) = (arguments.clone(), returned.clone());
            let host = machine.host_function(
                None,
                Rc::new(move |_, _, actual| {
                    assert_eq!(actual, expected);
                    Ok(answer.clone())
                }),
            );
            let instance = machine.load(&source, &[("host", &host)]);
            for name in ["twice", "call", "tail", "indirect", "again", "twice"] {
                assert_eq!(
                    machine.invoke(instance, name, &arguments).unwrap(),
                    returned
                );
            }
        }
    });
}

#[test]
fn as_many_values_as_a_function_can_have() {
    with_machine(engine(options()), |machine| {
        let types = vec![("v128", 128); 1000];
        let ty = format!("(param {0}) (result {0})", names(&types));
        let source = format!(r#"(import "" "host" (func $host {ty})) (export "f" (func $host))"#);
        let reverse = |_: &Machine, _: &_, it: &[Bits]| Ok(it.iter().rev().copied().collect());
        let host = machine.host_function(None, Rc::new(reverse));
        let instance = machine.load(&source, &[("host", &host)]);
        let mut values = Random(3).values(&types);
        let results = machine.invoke(instance, "f", &values).unwrap();
        values.reverse();
        assert_eq!(results, values);
    });
}

const NESTED: &str = r#"
    (import "" "host" (func $host (param i32) (result i32)))
    (memory 1)
    (tag $tag (export "tag") (param i32))
    (func $down (export "down") (param i32) (result i32)
        (if (result i32) (local.get 0)
            (then (i32.add (call $host (i32.sub (local.get 0) (i32.const 1))) (i32.const 1)))
            (else (i32.const 100))))
    (func $throw (export "throw") (param i32) (result i32) (throw $tag (i32.const 42)))
    (func $trap (export "trap") (param i32) (result i32) unreachable)
    (func $fault (export "fault") (param i32) (result i32) (i32.load (i32.const -1)))
    (func $operation (export "operation") (param i32) (result i32)
        (memory.fill (i32.const -1) (i32.const 0) (i32.const 2)) (i32.const 0))
    (func $catch (export "catch") (result i32)
        (i32.store (i32.const 8) (i32.const 1000))
        (block $caught (result i32)
            (try_table (result i32) (catch $tag $caught) (call $host (i32.const 0))))
        (i32.add (i32.load (i32.const 8))))
    (func (export "catch_all") (result i32)
        (block $caught
            (try_table (catch_all $caught) (drop (call $host (i32.const 0))))
            (return (i32.const 0)))
        (i32.const 1))
    (func (export "tail") (param i32) (result i32) (return_call $host (local.get 0)))"#;

#[test]
fn the_host_calls_back() {
    for_each_mode(|machine| {
        let target = Rc::new(Cell::new("down"));
        let name = target.clone();
        let host = machine.host_function(
            None,
            Rc::new(move |machine, instance, it| machine.invoke(instance, name.get(), it)),
        );
        let instance = machine.load(NESTED, &[("host", &host)]);
        assert_eq!(machine.invoke(instance, "down", &[50]), Ok(vec![150]));

        target.set("throw");
        assert_eq!(machine.invoke(instance, "catch", &[]), Ok(vec![1042]));
        assert_eq!(machine.invoke(instance, "catch_all", &[]), Ok(vec![1]));
        for name in ["down", "tail"] {
            let uncaught = machine.invoke(instance, name, &[1]);
            assert!(matches!(uncaught, Err(Failure::Exception(_))));
        }

        for (name, func, trap) in [
            ("trap", 3, Trap::Unreachable),
            ("fault", 4, Trap::MemoryOutOfBounds),
            ("operation", 5, Trap::MemoryOutOfBounds),
        ] {
            target.set(name);
            assert_eq!(
                machine.invoke(instance, "catch_all", &[]),
                Err(Failure::Trap(trap))
            );
            assert_eq!(*machine.stack_trace.borrow(), [func, 7]);
            assert_eq!(
                machine.invoke(instance, "tail", &[0]),
                Err(Failure::Trap(trap))
            );
            assert_eq!(*machine.stack_trace.borrow(), [func]);
        }
        target.set("down");
        assert_eq!(machine.invoke(instance, "down", &[2]), Ok(vec![102]));
    });
}

#[test]
fn the_host_sees_the_stack() {
    with_machine(engine(options()), |machine| {
        let seen = Rc::new(RefCell::new(Vec::new()));
        let log = seen.clone();
        let host = machine.host_function(
            None,
            Rc::new(move |machine, instance, it| {
                log.borrow_mut().push(machine.capture_stack_trace(10));
                let result = machine.invoke(instance, "down", it);
                log.borrow_mut().push(machine.capture_stack_trace(10));
                result
            }),
        );
        let instance = machine.load(NESTED, &[("host", &host)]);
        machine.invoke(instance, "down", &[2]).unwrap();
        assert_eq!(*seen.borrow(), [vec![1], vec![1, 1], vec![1, 1], vec![1]]);
    });
}

#[test]
fn a_handler_gets_its_own_instance_back() {
    for_each_mode(|machine| {
        let thrower = machine.load(
            r#"(memory 1) (data (i32.const 0) "\01")
            (tag $tag (export "tag") (param i32 i64 v128 f32))
            (func (export "throw")
                (throw $tag (i32.load (i32.const 0)) (i64.const -2) (v128.const i64x2 3 4) (f32.const 1.5)))"#,
            &[],
        );
        let [tag, throw] = ["tag", "throw"].map(|it| export(thrower, it.as_bytes()).unwrap());
        let catcher = machine.load(
            r#"(import "" "tag" (tag $tag (param i32 i64 v128 f32)))
            (import "" "throw" (func $throw))
            (memory 1) (data (i32.const 0) "\07")
            (global $g (mut i32) (i32.const 9))
            (func (export "catch") (result i32 i64 v128 f32 i32 i32)
                (block $caught (result i32 i64 v128 f32)
                    (try_table (catch $tag $caught) (call $throw))
                    unreachable)
                (i32.load (i32.const 0))
                (global.get $g))
            (func (export "rethrow") (result i32)
                (block $outer (result i32 i64 v128 f32)
                    (try_table (catch $tag $outer)
                        (block $inner (result exnref)
                            (try_table (catch_all_ref $inner) (call $throw))
                            unreachable)
                        throw_ref)
                    unreachable)
                drop drop drop)
            (func (export "null") (throw_ref (ref.null exn)))"#,
            &[("tag", &tag), ("throw", &throw)],
        );
        let payload = vec![1, u64::MAX as u128 - 1, 4 << 64 | 3, 0x3fc0_0000, 7, 9];
        assert_eq!(machine.invoke(catcher, "catch", &[]), Ok(payload));
        assert_eq!(machine.invoke(catcher, "rethrow", &[]), Ok(vec![1]));
        let null = machine.invoke(catcher, "null", &[]);
        assert_eq!(null, Err(Failure::Trap(Trap::NullExnref)));
    });
}

const OVERFLOW: Result<Vec<Bits>, Failure> = Err(Failure::Trap(Trap::StackOverflow));

#[test]
fn the_stack_overflows_anywhere() {
    let locals = "i64 ".repeat(20_000);
    let source = format!(
        r#"(import "" "host" (func $host (param i32) (result i32)))
        (type $s (struct (field i32)))
        (memory 1)
        (func $plain (export "plain") (call $plain))
        (func $large (export "large") (local {locals}) (call $large))
        (func (export "through_host") (param i32) (result i32) (call $host (local.get 0)))
        (func $busy (export "busy")
            (drop (struct.new_default $s))
            (drop (memory.grow (i32.const 0)))
            (memory.fill (i32.const 0) (i32.const 0) (i32.const 8))
            (call $busy))
        (func $caught (export "caught")
            (block $handler (try_table (catch_all $handler) (call $caught))))"#
    );
    for_each_mode(|machine| {
        let again = |machine: &Machine, it: &_, arguments: &[Bits]| {
            machine.invoke(it, "through_host", arguments)
        };
        let host = machine.host_function(None, Rc::new(again));
        let instance = machine.load(&source, &[("host", &host)]);
        for name in ["plain", "large", "busy", "caught", "plain"] {
            assert_eq!(machine.invoke(instance, name, &[]), OVERFLOW);
        }
        assert_eq!(machine.invoke(instance, "through_host", &[0]), OVERFLOW);
    });
}

/// With less and less of the stack left.
#[test]
fn first_calls_near_the_end_of_the_stack() {
    let source = r#"
        (func $fresh (result i32) (i32.const 5))
        (func $down (export "down") (param i32) (result i32)
            (if (result i32) (local.get 0)
                (then (call $down (i32.sub (local.get 0) (i32.const 1))))
                (else (call $fresh))))"#;
    with_machine(engine(options()), |machine| {
        let reaches = |depth| machine.invoke(machine.load(source, &[]), "down", &[depth]);
        let (mut low, mut high) = (0, 1 << 20);
        while low + 1 < high {
            let middle = (low + high) / 2;
            match reaches(middle) {
                OVERFLOW => high = middle,
                other => {
                    assert_eq!(other, Ok(vec![5]));
                    low = middle;
                }
            }
        }
        let (instance, beyond) = (machine.load(source, &[]), high + 50);
        assert_eq!(machine.invoke(instance, "down", &[beyond]), OVERFLOW);
        assert_eq!(machine.invoke(instance, "down", &[0]), Ok(vec![5]));
        assert_eq!(machine.invoke(instance, "down", &[beyond]), Ok(vec![5]));
    });
}

#[test]
fn functions_that_call_are_interrupted() {
    for tiering in [Tiering::BaselineOnly, Tiering::OptimizedOnly] {
        let options = Options {
            tiering,
            optimizer: optimize_fully,
            ..options()
        };
        with_machine(engine(options), |machine| {
            let source = format!(
                r#"(func $sum (export "sum") (param i32 f64 v128) (result i64)
                    (if (local.get 0) (then (return (i64.add (i64.const 1)
                        (call $sum (i32.sub (local.get 0) (i32.const 1)) (local.get 1) (local.get 2))))))
                    (i64.add (i64.trunc_f64_s (local.get 1)) (i64x2.extract_lane 1 (local.get 2))))
                (func $large (export "large") (param i32) (result i32) (local {}) (local.get 0))
                (func $ping (export "ping") (return_call $pong)) (func $pong (return_call_indirect (i32.const 0)))
                (func $again (export "again") (param i32 f64) (result f64)
                    (if (i32.eqz (local.get 0)) (then (return (local.get 1))))
                    (return_call $again (i32.sub (local.get 0) (i32.const 1)) (f64.add (local.get 1) (f64.const 1))))
                (table 1 funcref) (elem (i32.const 0) func $ping)"#,
                "v128 ".repeat(200)
            );
            let before = machine.load(&source, &[]);
            machine.interrupts_left.set(1000);
            machine.store().interrupts().update(|| true);
            for instance in [before, machine.load(&source, &[])] {
                let arguments = [9, 20f64.to_bits().into(), 300 << 64];
                assert_eq!(machine.invoke(instance, "sum", &arguments), Ok(vec![329]));
                assert_eq!(machine.invoke(instance, "large", &[7]), Ok(vec![7]));
                let turns = machine.invoke(instance, "again", &[50, 0]);
                assert_eq!(turns, Ok(vec![50f64.to_bits().into()]));
            }
            assert!(machine.interrupts_left.get() < 1000);
            assert_eq!(machine.invoke(before, "ping", &[]), Err(Failure::Exit(-2)));
            machine.interrupts_left.set(100);
            machine.store().interrupts().update(|| true);
            let endless = machine.invoke(before, "again", &[u32::MAX.into(), 0]);
            assert_eq!(endless, Err(Failure::Exit(-2)));
        });
    }
}

#[test]
fn a_function_has_one_object() {
    with_machine(engine(options()), |machine| {
        let host = machine.host_function(None, Rc::new(|_, _, _| Ok(vec![])));
        let first = machine.load(
            r#"(import "" "host" (func $host))
            (export "host" (func $host))
            (table (export "table") 3 funcref)
            (elem (i32.const 0) func $f $host)
            (func $f (export "f"))
            (func (export "get") (param i32) (result funcref) (table.get (local.get 0)))"#,
            &[("host", &host)],
        );
        let get = |index| machine.invoke(first, "get", &[index]).unwrap()[0];
        let (from_table, host_from_table) = (get(0), get(1));
        assert_eq!(get(2), Reference::NULL.into());
        assert_eq!([get(0), get(1), get(2)], [from_table, host_from_table, 2]);
        for (name, expected) in [("f", from_table), ("host", host_from_table)] {
            let item = export(first, name.as_bytes()).unwrap();
            let Item::Function(function) = item else {
                panic!()
            };
            assert_eq!(Bits::from(Reference::from(function)), expected);
            let second = machine.load(
                r#"(import "" "f" (func $f)) (table 1 funcref) (elem (i32.const 0) func $f)
                (func (export "reference") (result funcref) (ref.func $f))
                (func (export "element") (result funcref) (table.get (i32.const 0)))"#,
                &[("f", &item)],
            );
            assert_eq!(machine.invoke(second, "reference", &[]), Ok(vec![expected]));
            assert_eq!(machine.invoke(second, "element", &[]), Ok(vec![expected]));
        }
    });
}

#[test]
fn operations_tell_the_host_who_calls() {
    let operations = [
        "(drop (memory.grow (i32.const 0)))",
        "(drop (memory.atomic.wait32 1 (i32.const 0) (i32.const 1) (i64.const 0)))",
        "(drop (memory.atomic.wait64 1 (i32.const 0) (i64.const 1) (i64.const 0)))",
        "(drop (table.get (i32.const 0)))",
        "(drop (table.grow (ref.null func) (i32.const 1)))",
        "(drop (ref.func $f))",
        "(drop (struct.new_default $s))",
        "(drop (array.new $a (i32.const 1) (i32.const 1000)))",
        "(drop (array.new_default $a (i32.const 1000)))",
        "(drop (array.new_data $a $d (i32.const 0) (i32.const 1)))",
        "(drop (array.new_elem $funcs $e (i32.const 0) (i32.const 0)))",
        "(array.init_elem $funcs $e (global.get $g) (i32.const 0) (i32.const 0) (i32.const 1))",
        "(throw $tag)",
        "(throw_ref (global.get $exn))",
    ];
    for operation in operations {
        with_machine(engine(options()), |machine| {
            let source = format!(
                r#"(type $s (struct)) (type $a (array i8)) (type $funcs (array (mut funcref)))
                (memory 1) (memory 1 1 shared) (table 1 funcref) (tag $tag)
                (global $g (ref $funcs) (array.new_fixed $funcs 9 {}))
                (global $exn (mut exnref) (ref.null exn))
                (elem (i32.const 0) func $f) (elem $e func $f) (data $d "a")
                (func $f) (func $throw (throw $tag)) (func $inner {operation})
                (func (export "outer") (call $inner))
                (func (export "prepare") (global.set $exn (block $caught (result exnref)
                    (try_table (catch_all_ref $caught) (call $throw)) unreachable)))"#,
                "(ref.null func) ".repeat(9)
            );
            let instance = machine.load(&source, &[]);
            machine.invoke(instance, "prepare", &[]).unwrap();
            let Some(Item::Function(outer)) = export(instance, b"outer") else {
                panic!()
            };
            machine.callers.replace(Some(Vec::new()));
            let _ = machine.call(outer, &[]);
            assert_eq!(machine.callers.take(), Some(vec![2, 3]), "{operation}");
        });
    }
}

#[test]
fn native_imports_get_the_words() {
    #[native_abi]
    unsafe fn mix(a: u64, b: u64, c: u64, _: HostCell) -> Outcome {
        spoil_registers();
        let result = (c != 0).then(|| u64::from((a * 100 + b * 10 + c) as u32));
        result.ok_or(Trap::IllegalArgument).into()
    }
    let source = r#"
        (type $t (func (param i32 i64 i32) (result i32)))
        (import "" "mix" (func $mix (type $t)))
        (memory 1) (data (i32.const 0) "\07") (table 1 funcref) (elem (i32.const 0) func $mix)
        (export "itself" (func $mix))
        (func (export "call") (type $t)
            (i32.add (call $mix (local.get 0) (local.get 1) (local.get 2)) (i32.load (i32.const 0)))
            (i32.sub (i32.const 7)))
        (func (export "indirect") (type $t)
            (call_indirect (type $t) (local.get 0) (local.get 1) (local.get 2) (i32.const 0)))
        (func (export "tail") (type $t) (return_call $mix (local.get 0) (local.get 1) (local.get 2)))"#;
    for_each_mode(|machine| {
        let instance = machine.load(source, &[("mix", &Item::Native(mix))]);
        for name in ["itself", "call", "indirect", "tail"] {
            assert_eq!(machine.invoke(instance, name, &[1, 2, 3]), Ok(vec![123]));
            let trap = Failure::Trap(Trap::IllegalArgument);
            assert_eq!(machine.invoke(instance, name, &[1, 2, 0]), Err(trap));
        }
    });
}
