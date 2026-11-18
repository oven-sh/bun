//! What can be reached survives, whenever the collector runs.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::rc::Rc;
use std::sync::atomic::Ordering;

use bun_engine_wasm_format::{MemoryIndex, TableIndex};
use bun_engine_wasm_runtime::Instance;
use support::link::{Item, export};
use support::machine::Machine;
use support::{engine, heap, options, with_machine};

/// Each `store` puts a new object in a place that is old by then, and `load` reads it.
const PLACES: &str = r#"
    (type $box (struct (field i32)))
    (type $holder (struct (field (mut (ref null $box)))))
    (type $boxes (array (mut (ref null $box))))
    (tag $tag (param (ref $box)))
    (table $t 4 (ref null $box))
    (table $other 4 (ref null $box))
    (table $growing 0 (ref null $box))
    (global $inline (mut (ref null $box)) (ref.null $box))
    (global $indirect (export "g") (mut (ref null $box)) (ref.null $box))
    (global $exception (mut exnref) (ref.null exn))
    (global $holder (ref $holder) (struct.new_default $holder))
    (global $array (ref $boxes) (array.new_default $boxes (i32.const 4)))
    (elem $e (ref null $box) (struct.new $box (i32.const 5)) (struct.new $box (i32.const 5)))
    (func $new (result (ref $box)) (struct.new $box (i32.const 5)))
    (func $value (param (ref null $box)) (result i32) (struct.get $box 0 (local.get 0)))
    (func $element (result i32) (call $value (array.get $boxes (global.get $array) (i32.const 1))))

    (func (export "store inline") (global.set $inline (call $new)))
    (func (export "load inline") (result i32) (call $value (global.get $inline)))
    (func (export "store indirect") (global.set $indirect (call $new)))
    (func (export "load indirect") (result i32) (call $value (global.get $indirect)))
    (func (export "store field") (struct.set $holder 0 (global.get $holder) (call $new)))
    (func (export "load field") (result i32) (call $value (struct.get $holder 0 (global.get $holder))))
    (func (export "store table.set") (table.set $t (i32.const 0) (call $new)))
    (func (export "load table.set") (result i32) (call $value (table.get $t (i32.const 0))))
    (func (export "store table.fill") (table.fill $t (i32.const 1) (call $new) (i32.const 2)))
    (func (export "load table.fill") (result i32) (call $value (table.get $t (i32.const 2))))
    (func (export "store table.grow") (drop (table.grow $growing (call $new) (i32.const 3))))
    (func (export "load table.grow") (result i32)
        (call $value (table.get $growing (i32.sub (table.size $growing) (i32.const 1)))))
    (func (export "store table.copy")
        (table.set $t (i32.const 3) (call $new))
        (table.copy $other $t (i32.const 0) (i32.const 3) (i32.const 1))
        (table.set $t (i32.const 3) (ref.null $box)))
    (func (export "load table.copy") (result i32) (call $value (table.get $other (i32.const 0))))
    (func (export "store array.set") (array.set $boxes (global.get $array) (i32.const 1) (call $new)))
    (export "load array.set" (func $element))
    (func (export "store array.fill")
        (array.fill $boxes (global.get $array) (i32.const 0) (call $new) (i32.const 4)))
    (export "load array.fill" (func $element))
    (func (export "store array.copy")
        (array.copy $boxes $boxes (global.get $array) (i32.const 0)
            (array.new $boxes (call $new) (i32.const 2)) (i32.const 0) (i32.const 2)))
    (export "load array.copy" (func $element))
    (func (export "store exception")
        (global.set $exception
            (block $caught (result exnref)
                (try_table (catch_all_ref $caught) (throw $tag (call $new))) unreachable)))
    (func (export "load exception") (result i32)
        (call $value
            (block $caught (result (ref $box))
                (try_table (catch $tag $caught) (throw_ref (global.get $exception))) unreachable)))
    (func (export "store segment"))
    (func (export "load segment") (result i32)
        (array.init_elem $boxes $e (global.get $array) (i32.const 0) (i32.const 0) (i32.const 2))
        (call $element))"#;

#[inline(never)]
fn clear_dead_stack() {
    std::hint::black_box([0u8; 16 << 10]);
}

fn collect(machine: &Machine, is_full: bool) {
    clear_dead_stack();
    machine.collect(is_full);
}

fn store_and_load(machine: &Machine) {
    let instance = machine.load(PLACES, &[]);
    let module = instance.module();
    let names = module.exports().iter().map(|it| module.bytes(it.name));
    for place in names.filter_map(|it| std::str::from_utf8(it).unwrap().strip_prefix("store ")) {
        for is_full in [false, true, false] {
            collect(machine, true);
            machine
                .invoke(instance, &format!("store {place}"), &[])
                .unwrap();
            collect(machine, is_full);
            let loaded = machine.invoke(instance, &format!("load {place}"), &[]);
            assert_eq!(loaded, Ok(vec![5]), "{place}");
        }
    }
}

#[test]
fn stores_are_seen() {
    for interval in [1, 2, 3, u32::MAX] {
        with_machine(engine(options()), |machine| {
            machine.collect_every(interval);
            store_and_load(machine);
            assert!(machine.cells_freed() > 0);
        });
    }
    // As while a collector runs beside the program. No other test minds.
    heap::BARRIER_THRESHOLD.store(100, Ordering::Relaxed);
    with_machine(engine(options()), |machine| {
        machine.collect_every(2);
        store_and_load(machine);
    });
    heap::BARRIER_THRESHOLD.store(0, Ordering::Relaxed);
}

#[inline(never)]
fn load_provider(machine: &Machine, name: &str) -> Item {
    let provider = machine.load(
        r#"(memory 1) (data (i32.const 0) "\2a")
        (table (export "table") 1 funcref) (elem (i32.const 0) func $f)
        (global (export "global") (mut funcref) (ref.func $f))
        (global (export "constant") funcref (ref.func $f))
        (func $f (export "function") (result i32) (i32.load (i32.const 0)))"#,
        &[],
    );
    export(provider, name.as_bytes()).unwrap()
}

#[test]
fn an_instance_lives_on_in_its_functions() {
    let users = [
        ("function", "(func $it (result i32))", "(call $it)"),
        (
            "table",
            "(table 1 funcref)",
            "(call_indirect (type $f) (i32.const 0))",
        ),
        (
            "global",
            "(global $it (mut funcref))",
            "(call_ref $f (ref.cast (ref $f) (global.get $it)))",
        ),
        (
            "constant",
            "(global $it funcref)",
            "(call_ref $f (ref.cast (ref $f) (global.get $it)))",
        ),
    ];
    with_machine(engine(options()), |machine| {
        machine.collect_every(3);
        for (name, import, call) in users {
            let source = format!(
                r#"(type $f (func (result i32))) (import "" "it" {import})
                (func (export "use") (result i32) {call})"#
            );
            let user = machine.load(&source, &[("it", &load_provider(machine, name))]);
            machine.unroot_all();
            machine.root(user.cell());
            collect(machine, true);
            assert_eq!(machine.invoke(user, "use", &[]), Ok(vec![42]), "{name}");
        }
    });
}

#[test]
fn a_table_that_is_copied_or_filled_keeps_instances() {
    with_machine(engine(options()), |machine| {
        machine.collect_every(u32::MAX);
        let user = machine.load(
            r#"(table $t (export "t") 2 funcref)
            (func (export "use") (result i32) (call_indirect (result i32) (i32.const 1)))"#,
            &[],
        );
        let table = export(user, b"t").unwrap();
        for filler in [
            "(elem (table $t) (i32.const 1) func $f)",
            "(table $own 1 funcref) (elem (table $own) (i32.const 0) func $f) (start $copy)
            (func $copy (table.copy $t $own (i32.const 1) (i32.const 0) (i32.const 1)))",
        ] {
            #[inline(never)]
            fn fill(machine: &Machine, filler: &str, table: &Item) {
                let source = format!(
                    r#"(import "" "t" (table $t 2 funcref)) (global $g i32 (i32.const 3))
                    (func $f (result i32) (global.get $g)) {filler}"#
                );
                machine.load(&source, &[("t", table)]);
            }
            collect(machine, true);
            fill(machine, filler, &table);
            machine.unroot_all();
            machine.root(user.cell());
            collect(machine, false);
            assert_eq!(machine.invoke(user, "use", &[]), Ok(vec![3]));
        }
    });
}

#[test]
fn what_an_instance_shared_outlives_it() {
    #[inline(never)]
    fn parts(instance: &Instance) -> (Item, Item) {
        let memory = Item::Memory(Rc::clone(instance.memory(MemoryIndex(0))));
        (
            memory,
            Item::Table(Rc::clone(instance.table(TableIndex(0)))),
        )
    }
    with_machine(engine(options()), |machine| {
        machine.collect_every(u32::MAX);
        let (memory, table) = parts(machine.load("(memory 1) (table 1 externref)", &[]));
        let (Item::Memory(memory), Item::Table(table)) = (memory, table) else {
            panic!()
        };
        machine.unroot_all();
        machine.root(memory.owner().unwrap());
        machine.root(table.owner().unwrap());
        collect(machine, true);
        assert_eq!(machine.cells_freed(), 1);
        assert_eq!(memory.grow(1), Ok(1));
        // SAFETY: an `externref`.
        assert_eq!(unsafe { table.grow(100, machine.opaque(0)) }, Some(1));
    });
}

#[test]
fn objects_of_all_sizes_start_clean() {
    with_machine(engine(options()), |machine| {
        let allocators = machine.engine().layout().allocators;
        let cells = [8, 32, 33, 80, 96, 129, 256, 257].map(|it| allocators.for_size(it));
        let expected = [
            (0, 16),
            (1, 32),
            (2, 48),
            (4, 96),
            (4, 96),
            (6, 192),
            (7, 256),
        ];
        let expected = expected.map(|(class, size)| Some((class * allocators.stride as i32, size)));
        assert_eq!((&cells[..7], cells[7]), (&expected[..], None));

        machine.collect_every(5);
        let instance = machine.load(
            r#"(type $a (array i8)) (type $s (struct (field i8) (field v128) (field anyref) (field i16)))
            (func (export "array") (param $n i32) (result i32) (local $a (ref $a)) (local $sum i32)
                (local.set $a (array.new_default $a (local.get $n)))
                (loop $again
                    (if (local.get $n) (then
                        (local.set $n (i32.sub (local.get $n) (i32.const 1)))
                        (local.set $sum
                            (i32.or (local.get $sum) (array.get_u $a (local.get $a) (local.get $n))))
                        (br $again))))
                (i32.add (local.get $sum) (array.len (local.get $a))))
            (func (export "struct") (result i32 v128 anyref i32) (local $s (ref $s))
                (local.set $s (struct.new_default $s))
                (struct.get_u $s 0 (local.get $s)) (struct.get $s 1 (local.get $s))
                (struct.get $s 2 (local.get $s)) (struct.get_u $s 3 (local.get $s)))"#,
            &[],
        );
        for length in 0..300 {
            assert_eq!(
                machine.invoke(instance, "array", &[length]),
                Ok(vec![length])
            );
            assert_eq!(
                machine.invoke(instance, "struct", &[]),
                Ok(vec![0, 0, 2, 0])
            );
        }
    });
}

#[test]
fn constants_survive_while_others_are_made() {
    let boxes = |count| "(struct.new $box (i32.const 1)) ".repeat(count);
    let source = format!(
        r#"(type $box (struct (field i32))) (type $boxes (array (ref $box)))
        (global $g (ref $boxes) (array.new_fixed $boxes 50 {}))
        (elem $e (ref $box) {})
        (func $sum (param $a (ref $boxes)) (result i32) (local $n i32) (local $sum i32)
            (local.set $n (array.len (local.get $a)))
            (loop $again
                (local.set $n (i32.sub (local.get $n) (i32.const 1)))
                (local.set $sum (i32.add (local.get $sum)
                    (struct.get $box 0 (array.get $boxes (local.get $a) (local.get $n)))))
                (br_if $again (local.get $n)))
            (local.get $sum))
        (func (export "f") (result i32 i32)
            (call $sum (global.get $g))
            (call $sum (array.new_elem $boxes $e (i32.const 0) (i32.const 40))))"#,
        boxes(50),
        boxes(40)
    );
    with_machine(engine(options()), |machine| {
        machine.collect_every(1);
        let instance = machine.load(&source, &[]);
        assert_eq!(machine.invoke(instance, "f", &[]), Ok(vec![50, 40]));
    });
}

#[test]
fn an_instance_keeps_what_it_is_made_of() {
    with_machine(engine(options()), |machine| {
        machine.collect_every(u32::MAX);
        let host = machine.host_function(None, Rc::new(|_, _, _| Ok(vec![])));
        let source =
            r#"(import "" "host" (func $host)) (memory 1) (func (export "f") (call $host))"#;
        let instance = machine.load(source, &[("host", &host)]);
        collect(machine, true);
        assert_eq!(machine.cells_freed(), 0);
        assert_eq!(machine.invoke(instance, "f", &[]), Ok(vec![]));
    });
}
