#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::cell::Cell;
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Barrier, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{Limits, Memory as MemoryType};
use bun_engine_wasm_runtime::{
    Engine, GrowError, Instance, Module, Options, SharedMemory, Tiering,
};
use support::link::Item;
use support::machine::{Failure, Machine};
use support::{by_field, compile, engine, for_each_mode, options, spawn, waiters, with_machine};

const THREADS: usize = 6;
const STACK: usize = 256 << 10;
const FOREVER: u128 = u64::MAX as u128;

fn rounds(default: usize) -> usize {
    let factor = std::env::var("WASM_TEST_ROUNDS").map_or(1, |it| it.parse().unwrap());
    default * factor
}

fn shared_memory(engine: &'static Engine, maximum: u64) -> SharedMemory {
    let ty = MemoryType {
        address: Width::W32,
        pages: Limits {
            initial: 1,
            maximum: Some(maximum),
        },
        shared: true,
    };
    with_machine(engine, |machine| {
        machine.new_memory(ty).unwrap().share().unwrap()
    })
}

fn attach<'a>(machine: &'a Machine, module: &Arc<Module>, memory: &SharedMemory) -> &'a Instance {
    let memory = Item::Memory(machine.adopt_memory(memory.clone()));
    let calls = Cell::new(0u32);
    let collect = machine.host_function(
        None,
        Rc::new(move |machine, _, _| {
            calls.update(|it| it + 1);
            if calls.get().is_multiple_of(61) {
                machine.collect(false);
            }
            Ok(vec![1])
        }),
    );
    machine
        .instantiate(
            module,
            &by_field(&[("memory", &memory), ("collect", &collect)]),
        )
        .unwrap()
}

/// Runs `body` on all threads at once, each with an instance and a number.
fn on_all_threads<T: Send>(
    module: &Arc<Module>,
    memory: &SharedMemory,
    body: impl Fn(&Machine, &Instance, usize) -> T + Sync,
) -> Vec<T> {
    let (start, body) = (&Barrier::new(THREADS), &body);
    thread::scope(|scope| {
        let thread = |number| {
            spawn(scope, module.engine(), STACK, move |machine| {
                let instance = attach(machine, module, memory);
                start.wait();
                body(machine, instance, number)
            })
        };
        let threads: [_; THREADS] = std::array::from_fn(thread);
        threads.map(|it| it.join().unwrap()).into()
    })
}

fn engines() -> [&'static Engine; 2] {
    [true, false].map(|handle_faults| {
        engine(Options {
            handle_faults,
            ..options()
        })
    })
}

const ATOMICS: &str = r#"
    (import "" "memory" (memory 1 1000 shared))
    (func (export "wait32") (param i32 i32 i64) (result i32)
        (memory.atomic.wait32 (local.get 0) (local.get 1) (local.get 2)))
    (func (export "wait64") (param i32 i64 i64) (result i32)
        (memory.atomic.wait64 offset=8 (local.get 0) (local.get 1) (local.get 2)))
    (func (export "notify") (param i32 i32) (result i32)
        (memory.atomic.notify (local.get 0) (local.get 1)))
    (func (export "grow_and_mark") (param i32) (result i32) (local $old i32)
        (local.set $old (memory.grow (i32.const 1)))
        (i32.store (i32.shl (local.get $old) (i32.const 16)) (local.get 0))
        (drop (i32.load (i32.sub (i32.shl (memory.size) (i32.const 16)) (i32.const 4))))
        (memory.fill (i32.sub (i32.shl (memory.size) (i32.const 16)) (i32.const 8)) (i32.const 1) (i32.const 8))
        (local.get $old))
    (func $lock
        (if (i32.atomic.rmw.cmpxchg (i32.const 0) (i32.const 0) (i32.const 1)) (then
            (loop $again
                (if (i32.atomic.rmw.xchg (i32.const 0) (i32.const 2)) (then
                    (drop (memory.atomic.wait32 (i32.const 0) (i32.const 2) (i64.const -1)))
                    (br $again)))))))
    (func $unlock
        (if (i32.eq (i32.atomic.rmw.xchg (i32.const 0) (i32.const 0)) (i32.const 2)) (then
            (drop (memory.atomic.notify (i32.const 0) (i32.const 1))))))
    (func (export "count") (param $n i32)
        (loop $again
            (call $lock)
            (i32.store (i32.const 4) (i32.add (i32.load (i32.const 4)) (i32.const 1)))
            (call $unlock)
            (br_if $again (local.tee $n (i32.sub (local.get $n) (i32.const 1))))))"#;

fn word_at(memory: &SharedMemory, address: usize) -> u32 {
    // SAFETY: aligned and in bounds.
    let word = unsafe { AtomicU32::from_ptr(memory.pages().base().add(address).cast()) };
    word.load(Ordering::SeqCst)
}

#[test]
fn a_shared_memory_grows_on_all_threads() {
    for engine in engines() {
        let module = compile(engine, ATOMICS);
        for _ in 0..rounds(3) {
            let memory = shared_memory(engine, 1000);
            let pages = on_all_threads(&module, &memory, |machine, instance, number| {
                let grow = |_| machine.invoke(instance, "grow_and_mark", &[number as u128]);
                (0..100)
                    .map(|it| grow(it).unwrap()[0] as usize)
                    .collect::<Vec<_>>()
            });
            let count = 1 + 100 * THREADS as u64;
            assert_eq!(memory.grow_to(count - 1), Err(GrowError::InvalidSize));
            assert_eq!(memory.grow_to(1001), Err(GrowError::ExceedsMaximum));
            assert_eq!(memory.pages().len(), count << 16);
            assert_eq!(memory.grow_to(1000), Ok(()));
            assert_eq!(memory.pages().len(), 1000 << 16);
            for (number, pages) in pages.iter().enumerate() {
                assert!(
                    pages
                        .iter()
                        .all(|it| word_at(&memory, it << 16) == number as u32)
                );
            }
        }
    }
}

#[test]
fn a_lock_made_of_wait_and_notify() {
    for engine in engines() {
        let (module, memory) = (compile(engine, ATOMICS), shared_memory(engine, 1000));
        let turns = rounds(3000);
        on_all_threads(&module, &memory, |machine, instance, _| {
            machine.invoke(instance, "count", &[turns as u128]).unwrap();
        });
        assert_eq!(word_at(&memory, 4) as usize, turns * THREADS);
    }
}

#[test]
fn how_a_wait_ends() {
    let engine = engine(options());
    let (module, memory) = (compile(engine, ATOMICS), shared_memory(engine, 1000));
    with_machine(engine, |machine| {
        let instance = attach(machine, &module, &memory);
        let call = |name, arguments: &[u128]| machine.invoke(instance, name, arguments);
        let out_of_bounds = Err(Failure::Trap(Trap::MemoryOutOfBounds));
        assert_eq!(call("wait32", &[0, 1, FOREVER]), Ok(vec![1]));
        assert_eq!(call("wait64", &[0, 1 << 32, FOREVER]), Ok(vec![1]));
        assert_eq!(call("wait32", &[0, 0, 0]), Ok(vec![2]));
        let start = Instant::now();
        assert_eq!(call("wait64", &[0, 0, 2_000_000]), Ok(vec![2]));
        assert!(start.elapsed() >= Duration::from_millis(2));
        assert_eq!(call("notify", &[8, 1]), Ok(vec![0]));
        assert_eq!(call("wait32", &[2, 0, 0]), out_of_bounds);
        assert_eq!(call("wait64", &[4, 0, 0]), out_of_bounds);
        assert_eq!(call("wait32", &[65536, 0, 0]), out_of_bounds);
        assert_eq!(call("wait64", &[65528, 0, 0]), out_of_bounds);
        assert_eq!(call("notify", &[1, 0]), out_of_bounds);
        assert_eq!(call("notify", &[65536, 0]), out_of_bounds);

        machine.parker.interrupt();
        assert_eq!(call("wait32", &[0, 0, FOREVER]), Err(Failure::Exit(-1)));
        assert_eq!(call("notify", &[0, 1]), Ok(vec![0]));

        let unshared = ATOMICS.replace(
            r#"(import "" "memory" (memory 1 1000 shared))"#,
            "(memory 1)",
        );
        let unshared = machine.load(&unshared, &[]);
        assert_eq!(
            machine.invoke(unshared, "wait32", &[0, 1, 0]),
            out_of_bounds
        );
        assert_eq!(machine.invoke(unshared, "notify", &[0, 1]), Ok(vec![0]));
    });
}

#[test]
fn another_thread_ends_a_wait() {
    let engine = engine(options());
    let (module, memory) = (compile(engine, ATOMICS), shared_memory(engine, 1000));
    for _ in 0..rounds(20) {
        let (send, receive) = mpsc::channel();
        thread::scope(|scope| {
            let waiter = spawn(scope, engine, STACK, |machine| {
                let instance = attach(machine, &module, &memory);
                send.send(Arc::clone(&machine.parker)).unwrap();
                let first = machine.invoke(instance, "wait32", &[16, 0, i64::MAX as u128]);
                (first, machine.invoke(instance, "wait32", &[16, 0, FOREVER]))
            });
            let address = memory.pages().base().addr() + 16;
            while waiters::notify(address, u32::MAX) == 0 {
                thread::yield_now();
            }
            receive.recv().unwrap().interrupt();
            assert_eq!(
                waiter.join().unwrap(),
                (Ok(vec![0]), Err(Failure::Exit(-1)))
            );
        });
    }
}

/// Function `n` loops a little and calls two earlier ones.
fn call_tree(count: usize) -> String {
    let function = |n: usize| {
        let calls = match n {
            0 => "(call $collect)".into(),
            _ => format!(
                "(i32.add (call $f{} (i32.const 1)) (call_indirect (type $t) (i32.const 1) (i32.const {})))",
                n / 2,
                n / 3
            ),
        };
        format!(
            r#"(func $f{n} (export "{n}") (type $t) (local $sum i32)
            (loop $again
                (local.set $sum (i32.add (local.get $sum) {calls}))
                (br_if $again (local.tee 0 (i32.sub (local.get 0) (i32.const 1)))))
            (local.get $sum))"#
        )
    };
    let names: Vec<_> = (0..count).map(|n| format!("$f{n}")).collect();
    format!(
        r#"(import "" "memory" (memory 1 1 shared)) (import "" "collect" (func $collect (result i32)))
        (type $t (func (param i32) (result i32)))
        (table {count} funcref) (elem (i32.const 0) func {}) {}"#,
        names.join(" "),
        (0..count).map(function).collect::<Vec<_>>().concat()
    )
}

fn leaves(n: usize) -> u128 {
    if n == 0 {
        1
    } else {
        leaves(n / 2) + leaves(n / 3)
    }
}

#[test]
fn threads_compile_replace_and_free_code_at_once() {
    const FUNCTIONS: usize = 40;
    let source = call_tree(FUNCTIONS);
    let settings = [
        (Tiering::BaselineOnly, true),
        (Tiering::OptimizedOnly, true),
        (Tiering::After(1), true),
        (Tiering::After(1), false),
        (Tiering::After(300), true),
    ];
    for (tiering, use_threads) in settings {
        let engine = engine(Options {
            tiering,
            use_threads,
            ..options()
        });
        for _ in 0..rounds(3) {
            let (module, memory) = (compile(engine, &source), shared_memory(engine, 1));
            on_all_threads(&module, &memory, |machine, instance, number| {
                for step in 0..3 * FUNCTIONS {
                    let n = (FUNCTIONS - 1 + step * (number / 2 * 2 + 1)) % FUNCTIONS;
                    let result = machine.invoke(instance, &n.to_string(), &[20]);
                    assert_eq!(result, Ok(vec![20 * leaves(n)]));
                }
            });
        }
    }
}

#[test]
fn faults_repeat_on_every_thread() {
    let source = r#"(type $a (array i64)) (memory 1 1 shared)
        (func (export "null") (result i32) (array.len (ref.null $a)))
        (func (export "store") (param i32) (v128.store (local.get 0) (v128.const i64x2 1 1)))
        (func (export "atomic") (param i32) (result i64) (i64.atomic.rmw.add (local.get 0) (i64.const 1)))"#;
    thread::scope(|scope| {
        for _ in 0..4 {
            scope.spawn(|| {
                for_each_mode(|machine| {
                    let instance = machine.load(source, &[]);
                    let trap = |trap| Err(Failure::Trap(trap));
                    for _ in 0..200 {
                        let call = |name, it: &[u128]| machine.invoke(instance, name, it);
                        assert_eq!(call("null", &[]), trap(Trap::NullReference));
                        assert_eq!(call("store", &[65521]), trap(Trap::MemoryOutOfBounds));
                        assert_eq!(call("atomic", &[65536]), trap(Trap::MemoryOutOfBounds));
                    }
                });
            });
        }
    });
}
