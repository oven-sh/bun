#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::rc::Rc;

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{GlobalIndex, MemoryIndex, TableIndex};
use bun_engine_wasm_runtime::{
    Bits, ConstantError, InitializeError, LinkError, Reference, SegmentError,
};
use support::link::{InstantiateError, Item, export};
use support::machine::{Failure, Machine};
use support::{by_field, compile, engine, options, with_machine};

fn error(machine: &Machine, source: &str, imports: &[(&str, &Item)]) -> Option<InstantiateError> {
    let module = compile(machine.engine(), source);
    machine.instantiate(&module, &by_field(imports)).err()
}

const TYPES: &str = "
    (type $base (sub (struct)))
    (type $derived (sub $base (struct (field i32))))
    (type $f (sub (func (result (ref null $base)))))
    (type $g (sub $f (func (result (ref null $derived)))))";

#[test]
fn imports_have_to_match() {
    use LinkError::*;
    let cases = [
        ("(func {} (type $g) unreachable)", "(func (type $f))", None),
        (
            "(func {} (type $f) unreachable)",
            "(func (type $g))",
            Some(Type),
        ),
        ("(func {} (param i32))", "(func (param i64))", Some(Type)),
        (
            "(global {} (ref null $derived) (ref.null none))",
            "(global (ref null $base))",
            None,
        ),
        (
            "(global {} (ref null $base) (ref.null none))",
            "(global (ref null $derived))",
            Some(Type),
        ),
        (
            "(global {} (mut (ref null $derived)) (ref.null none))",
            "(global (mut (ref null $base)))",
            Some(Type),
        ),
        (
            "(global {} (mut i32) (i32.const 0))",
            "(global i32)",
            Some(Mutability),
        ),
        (
            "(global {} i32 (i32.const 0))",
            "(global (mut i32))",
            Some(Mutability),
        ),
        (
            "(table {} 2 5 (ref null $f))",
            "(table 1 6 (ref null $f))",
            None,
        ),
        (
            "(table {} 2 (ref null $g))",
            "(table 1 (ref null $f))",
            Some(Type),
        ),
        ("(table {} 2 funcref)", "(table 3 funcref)", Some(TooSmall)),
        (
            "(table {} 2 funcref)",
            "(table 1 9 funcref)",
            Some(NoMaximum),
        ),
        (
            "(table {} 2 5 funcref)",
            "(table 1 4 funcref)",
            Some(MaximumTooLarge),
        ),
        (
            "(table {} i64 2 funcref)",
            "(table 1 funcref)",
            Some(Address),
        ),
        ("(memory {} 2 5)", "(memory 1 6)", None),
        ("(memory {} 2)", "(memory 3)", Some(TooSmall)),
        ("(memory {} 2)", "(memory 1 9)", Some(NoMaximum)),
        ("(memory {} 2 5)", "(memory 1 4)", Some(MaximumTooLarge)),
        ("(memory {} 2 5 shared)", "(memory 1 5)", Some(Sharing)),
        ("(memory {} 2 5)", "(memory 1 5 shared)", Some(Sharing)),
        ("(memory {} i64 2)", "(memory 1)", Some(Address)),
        (
            "(tag {} (param (ref $base)))",
            "(tag (param (ref $base)))",
            None,
        ),
        (
            "(tag {} (param (ref $derived)))",
            "(tag (param (ref $base)))",
            Some(Type),
        ),
    ];
    with_machine(engine(options()), |machine| {
        for (definition, import, expected) in cases {
            let definition = definition.replace("{}", r#"(export "it")"#);
            let item = export(machine.load(&format!("{TYPES} {definition}"), &[]), b"it").unwrap();
            // The types have other indices here.
            let source = format!(r#"(type (array i8)) {TYPES} (import "" "it" {import})"#);
            let actual = error(machine, &source, &[("it", &item)]);
            assert_eq!(
                actual,
                expected.map(InstantiateError::Link),
                "{definition} {import}"
            );
        }
    });
}

#[test]
fn what_was_written_before_a_failure_stays() {
    with_machine(engine(options()), |machine| {
        let owner = machine.load(
            r#"(memory (export "memory") 1) (table (export "table") 4 funcref)
            (func (export "call") (param i32) (result i32) (call_indirect (result i32) (local.get 0)))"#,
            &[],
        );
        let [memory, table] = ["memory", "table"].map(|it| export(owner, it.as_bytes()).unwrap());
        let failing = |rest: &str| {
            let source = format!(
                r#"(import "" "memory" (memory 1)) (import "" "table" (table 4 funcref))
                (global $g (mut i32) (i32.const 77))
                (func $f (result i32) (global.get $g)) (func $trap unreachable) {rest}"#
            );
            error(machine, &source, &[("memory", &memory), ("table", &table)]).unwrap()
        };
        let byte = |address| {
            let mut byte = [0];
            owner
                .memory(MemoryIndex(0))
                .read(address, &mut byte)
                .unwrap();
            byte[0]
        };
        let is_set = |index| machine.invoke(owner, "call", &[index]) == Ok(vec![77]);

        let elements = failing(
            r#"(elem (i32.const 0) func $f) (elem (i32.const 3) func $f $f) (data (i32.const 0) "a")"#,
        );
        assert_eq!(
            elements,
            InstantiateError::Segment(SegmentError::ElementsOutOfBounds)
        );
        assert_eq!((is_set(0), is_set(3), byte(0)), (true, false, 0));

        let data = failing(
            r#"(elem (i32.const 1) func $f) (data (i32.const 1) "b") (data (i32.const 65535) "cd")
            (data (i32.const 2) "e")"#,
        );
        let expected = SegmentError::DataOutOfBounds {
            memory_length: 65536,
            segment_length: 2,
            offset: 65535,
        };
        assert_eq!(data, InstantiateError::Segment(expected));
        assert_eq!(
            (is_set(1), byte(1), byte(65535), byte(2)),
            (true, b'b', 0, 0)
        );

        let item = failing(
            r#"(type $a (array i64)) (elem (i32.const 3) func $f)
            (elem declare anyref (array.new_default $a (i32.const 0x10000000)))"#,
        );
        let InstantiateError::Initialize(InitializeError::Constant(item)) = item else {
            panic!("{item:?}");
        };
        assert_eq!((item.trap, is_set(3)), (Trap::ArrayNewFailure, false));

        let start =
            failing(r#"(elem (i32.const 2) func $f) (data (i32.const 3) "f") (start $trap)"#);
        assert_eq!(
            start,
            InstantiateError::Start(Failure::Trap(Trap::Unreachable))
        );
        assert_eq!((is_set(2), byte(3)), (true, b'f'));
    });
}

#[test]
fn what_cannot_be_allocated() {
    with_machine(engine(options()), |machine| {
        let cases = [
            ("(table 10000001 funcref)", InitializeError::Table),
            ("(table i64 0x100000000 externref)", InitializeError::Table),
            ("(memory i64 0x10001)", InitializeError::OutOfMemory),
            (
                "(type $a (array i64)) (global (ref $a) (array.new_default $a (i32.const -1)))",
                InitializeError::Constant(ConstantError {
                    trap: Trap::ArrayNewFailure,
                    offset: 25,
                }),
            ),
        ];
        for (source, expected) in cases {
            assert_eq!(
                error(machine, source, &[]),
                Some(InstantiateError::Initialize(expected))
            );
        }
    });
}

#[test]
fn constant_expressions() {
    with_machine(engine(options()), |machine| {
        let base =
            Item::Global(machine.new_global(bun_engine_wasm_format::ValType::I32, false, 10));
        let instance = machine.load(
            r#"(type $s (struct (field i8) (field i64) (field i16) (field anyref) (field v128)))
            (type $a (array (mut i16)))
            (type $refs (array (ref null $s)))
            (import "" "base" (global $base i32))
            (global $sum (export "sum") i32
                (i32.sub (i32.mul (global.get $base) (i32.const 0x7fffffff)) (i32.const 1)))
            (global (export "copy") i32 (global.get $sum))
            (global (export "wide") (mut i64) (i64.add (i64.const -1) (i64.const 2)))
            (global (export "vector") (mut v128) (v128.const i64x2 1 2))
            (global (export "small") anyref (any.convert_extern (extern.convert_any (ref.i31 (i32.const -1)))))
            (global $s (ref $s) (struct.new $s
                (i32.const 0x1ff) (i64.const -5) (i32.const 0x18000) (ref.i31 (i32.const 3)) (v128.const i64x2 8 9)))
            (global $filled (ref $a) (array.new $a (i32.const 0x10007) (i32.const 3)))
            (global $fixed (ref $refs)
                (array.new_fixed $refs 3 (global.get $s) (ref.null $s) (struct.new_default $s)))
            (func (export "fields") (result i32 i64 i32 anyref v128)
                (struct.get_u $s 0 (global.get $s)) (struct.get $s 1 (global.get $s))
                (struct.get_s $s 2 (global.get $s)) (struct.get $s 3 (global.get $s))
                (struct.get $s 4 (global.get $s)))
            (func (export "elements") (result i32 i32 i32 i32 anyref)
                (array.len (global.get $filled))
                (array.get_u $a (global.get $filled) (i32.const 2))
                (ref.eq (global.get $s) (array.get $refs (global.get $fixed) (i32.const 0)))
                (ref.is_null (array.get $refs (global.get $fixed) (i32.const 1)))
                (struct.get $s 3 (array.get $refs (global.get $fixed) (i32.const 2))))"#,
            &[("base", &base)],
        );
        let global = |index| instance.global(GlobalIndex(index)).unwrap().get();
        let i31 = |value| Bits::from(Reference::from_i31(value));
        let sum = 10u32.wrapping_mul(0x7fff_ffff).wrapping_sub(1).into();
        assert_eq!(
            [1, 2, 3, 4, 5].map(global),
            [sum, sum, 1, 2 << 64 | 1, i31(-1)]
        );
        let fields = vec![0xff, u64::MAX as u128 - 4, 0xffff_8000, i31(3), 9 << 64 | 8];
        assert_eq!(machine.invoke(instance, "fields", &[]), Ok(fields));
        assert_eq!(
            machine.invoke(instance, "elements", &[]),
            Ok(vec![3, 7, 1, 1, 2])
        );
    });
}

#[test]
fn segments_belong_to_the_instance() {
    with_machine(engine(options()), |machine| {
        let module = compile(
            machine.engine(),
            r#"(type $s (struct)) (type $refs (array (mut anyref))) (type $bytes (array (mut i8)))
            (memory 1) (table $t 2 anyref)
            (elem $active (table $t) (i32.const 0) anyref (struct.new $s))
            (elem $passive anyref (ref.i31 (i32.const 1)) (struct.new $s) (ref.null any))
            (data $placed (i32.const 0) "xy") (data $kept "abc")
            (func (export "same") (result i32)
                (table.init $t $passive (i32.const 0) (i32.const 1) (i32.const 1))
                (ref.eq
                    (ref.cast (ref eq) (table.get $t (i32.const 0)))
                    (ref.cast (ref eq) (array.get $refs
                        (array.new_elem $refs $passive (i32.const 0) (i32.const 3)) (i32.const 1)))))
            (func (export "elements") (param i32)
                (table.init $t $passive (i32.const 0) (i32.const 0) (local.get 0)))
            (func (export "active_elements") (param i32)
                (table.init $t $active (i32.const 0) (i32.const 0) (local.get 0)))
            (func (export "bytes") (param i32) (result i32)
                (array.len (array.new_data $bytes $kept (i32.const 0) (local.get 0))))
            (func (export "active_bytes") (param i32)
                (memory.init $placed (i32.const 0) (i32.const 0) (local.get 0)))
            (func (export "drop") (elem.drop $passive) (data.drop $kept))"#,
        );
        let [first, second] =
            [(); 2].map(|()| machine.instantiate(&module, &by_field(&[])).unwrap());
        let trap = |trap| Err(Failure::Trap(trap));
        assert_eq!(machine.invoke(first, "same", &[]), Ok(vec![1]));
        assert_eq!(machine.invoke(first, "active_elements", &[0]), Ok(vec![]));
        assert_eq!(
            machine.invoke(first, "active_elements", &[1]),
            trap(Trap::TableOutOfBounds)
        );
        assert_eq!(machine.invoke(first, "active_bytes", &[0]), Ok(vec![]));
        assert_eq!(
            machine.invoke(first, "active_bytes", &[1]),
            trap(Trap::MemoryOutOfBounds)
        );
        for _ in 0..2 {
            machine.invoke(first, "drop", &[]).unwrap();
        }
        assert_eq!(machine.invoke(first, "elements", &[0]), Ok(vec![]));
        assert_eq!(
            machine.invoke(first, "elements", &[1]),
            trap(Trap::TableOutOfBounds)
        );
        assert_eq!(machine.invoke(first, "bytes", &[0]), Ok(vec![0]));
        assert_eq!(
            machine.invoke(first, "bytes", &[1]),
            trap(Trap::ArrayNewDataFailure)
        );
        assert_eq!(machine.invoke(second, "elements", &[2]), Ok(vec![]));
        assert_eq!(machine.invoke(second, "bytes", &[3]), Ok(vec![3]));
        assert_eq!(
            machine.invoke(second, "bytes", &[4]),
            trap(Trap::ArrayNewDataFailure)
        );
    });
}

#[test]
fn tables_grow_under_all_their_instances() {
    with_machine(engine(options()), |machine| {
        let functions = r#"
            (func $f (result i32) (i32.const 8)) (elem declare func $f)
            (func (export "grow") (param i32) (result i32) (table.grow (ref.func $f) (local.get 0)))
            (func (export "call") (param i32) (result i32) (call_indirect (result i32) (local.get 0)))"#;
        let owner = machine.load(
            &format!(r#"(table (export "t") 0 funcref) {functions}"#),
            &[],
        );
        let table = export(owner, b"t").unwrap();
        let source = format!(r#"(import "" "t" (table 0 funcref)) {functions}"#);
        let other = machine.load(&source, &[("t", &table)]);
        for length in 0..200 {
            let (grower, caller) = if length % 2 == 0 {
                (owner, other)
            } else {
                (other, owner)
            };
            let beyond = Err(Failure::Trap(Trap::IndirectCallOutOfBounds));
            assert_eq!(machine.invoke(caller, "call", &[length]), beyond);
            assert_eq!(machine.invoke(grower, "grow", &[1]), Ok(vec![length]));
            assert_eq!(machine.invoke(caller, "call", &[length]), Ok(vec![8]));
        }
        assert_eq!(
            machine.invoke(owner, "grow", &[10_000_000 - 199]),
            Ok(vec![0xffff_ffff])
        );
        assert_eq!(
            machine.invoke(owner, "grow", &[0xffff_ffff]),
            Ok(vec![0xffff_ffff])
        );
        assert_eq!(owner.table(TableIndex(0)).len(), 200);

        let limited = machine.load(&format!("(table 1 3 funcref) {functions}"), &[]);
        for (count, result) in [(3, 0xffff_ffff), (2, 1), (1, 0xffff_ffff), (0, 3)] {
            assert_eq!(machine.invoke(limited, "grow", &[count]), Ok(vec![result]));
        }
        let longest = machine.load(&format!("(table 10000000 funcref) {functions}"), &[]);
        assert_eq!(machine.invoke(longest, "grow", &[0]), Ok(vec![10_000_000]));
    });
}

#[test]
fn globals_are_shared() {
    with_machine(engine(options()), |machine| {
        let owner = machine.load(
            r#"(global $n (export "n") (mut i32) (i32.const 1))
            (global $r (export "r") (mut externref) (ref.null extern))
            (global (export "fixed") (export "again") f64 (f64.const 2))
            (func (export "get") (result i32 externref) (global.get $n) (global.get $r))"#,
            &[],
        );
        let [n, r, fixed] = ["n", "r", "fixed"].map(|it| export(owner, it.as_bytes()).unwrap());
        let other = machine.load(
            r#"(import "" "n" (global $n (mut i32))) (import "" "r" (global $r (mut externref)))
            (import "" "fixed" (global $fixed f64)) (export "fixed" (global $fixed))
            (func (export "set") (param i32 externref)
                (global.set $n (local.get 0)) (global.set $r (local.get 1)))"#,
            &[("n", &n), ("r", &r), ("fixed", &fixed)],
        );
        let values = vec![0xffff_fffe, machine.opaque(1).into()];
        machine.invoke(other, "set", &values).unwrap();
        assert_eq!(owner.global(GlobalIndex(0)).unwrap().get(), values[0]);
        assert_eq!(machine.invoke(owner, "get", &[]), Ok(values));
        let same = [
            export(owner, b"again"),
            export(other, b"fixed"),
            Some(fixed),
        ];
        let [
            Some(Item::Global(a)),
            Some(Item::Global(b)),
            Some(Item::Global(c)),
        ] = same
        else {
            panic!()
        };
        assert!(Rc::ptr_eq(&a, &b) && Rc::ptr_eq(&b, &c));
    });
}
