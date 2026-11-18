//! Looks at what the whole process uses, so there is one test only.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, Barrier, mpsc};

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::MemoryMode;
use bun_engine_wasm_format::{Limits, Memory as MemoryType, MemoryIndex};
use bun_engine_wasm_runtime::{
    Engine, MemoryUsage, Optimizer, Options, Tiering, Urgency, memory_usage,
    wait_for_background_work,
};
use support::link::Item;
use support::machine::Machine;
use support::{baseline_without_counters, by_field, compile, engine, options, spawn, with_machine};

fn code_usage() -> usize {
    bun_engine_exec_memory::usage().bytes_in_use
}

/// What the system says is reserved in pieces as large as those of memories.
fn mapped() -> u64 {
    if cfg!(bun_asan) {
        return 0;
    }
    let maps = std::fs::read_to_string("/proc/self/maps").unwrap_or_default();
    let size = |line: &str| {
        let (start, end) = line.split(' ').next()?.split_once('-')?;
        Some(u64::from_str_radix(end, 16).ok()? - u64::from_str_radix(start, 16).ok()?)
    };
    maps.lines()
        .filter_map(size)
        .filter(|it| (1 << 31..1 << 33).contains(it))
        .sum()
}

fn usage() -> (MemoryUsage, usize, u64) {
    wait_for_background_work();
    (memory_usage(), code_usage(), mapped())
}

fn tiering(use_threads: bool, optimizer: Optimizer) -> &'static Engine {
    engine(Options {
        tiering: Tiering::After(100),
        use_threads,
        optimizer,
        ..options()
    })
}

const BUSY: &str = r#"
    (import "" "host" (func $host))
    (memory 1) (memory 1 5 shared) (table 3 funcref) (tag) (global (export "g") (mut i32) (i32.const 0))
    (func $leaf (result i32) (i32.const 1))
    (func (export "f") (param $n i32) (result i32) (local $sum i32)
        (loop $again
            (local.set $sum (i32.add (local.get $sum) (call $leaf)))
            (br_if $again (local.tee $n (i32.sub (local.get $n) (i32.const 1)))))
        (call $host)
        (local.get $sum))"#;

fn nothing(machine: &Machine) -> Item {
    machine.host_function(None, Rc::new(|_, _, _| Ok(vec![])))
}

#[inline(never)]
fn clear_dead_stack() {
    std::hint::black_box([0u8; 16 << 10]);
}

fn all_goes_with_the_thread(engine: &'static Engine) {
    let before = usage();
    with_machine(engine, |machine| {
        let instance = machine.load(BUSY, &[("host", &nothing(machine))]);
        for _ in 0..50 {
            assert_eq!(machine.invoke(instance, "f", &[1000]), Ok(vec![1000]));
        }
        assert_ne!(usage(), before);
    });
    assert_eq!(usage(), before);
}

fn all_goes_with_the_instance(engine: &'static Engine) {
    #[inline(never)]
    fn run(machine: &Machine) {
        let instance = machine.load(BUSY, &[("host", &nothing(machine))]);
        let without_code = instance.module().footprint();
        machine.invoke(instance, "f", &[1000]).unwrap();
        machine.invoke(instance, "f", &[1000]).unwrap();
        assert!(instance.module().footprint() > without_code);
    }
    with_machine(engine, |machine| {
        machine.collect_every(u32::MAX);
        let before = usage();
        run(machine);
        machine.unroot_all();
        clear_dead_stack();
        wait_for_background_work();
        machine.collect(true);
        assert_eq!(usage(), before);
    });
}

fn replaced_code_stays_while_it_is_on_a_stack() {
    with_machine(tiering(false, baseline_without_counters), |machine| {
        let seen = Rc::new(RefCell::new(Vec::new()));
        let log = seen.clone();
        let host = machine.host_function(
            None,
            Rc::new(move |machine, instance, _| {
                if log.borrow().is_empty() {
                    log.borrow_mut().push(0);
                    // Replaces the code that the frame below has left for an entry at the loop.
                    machine.invoke(instance, "f", &[1])?;
                    clear_dead_stack();
                    machine.collect(false);
                    log.borrow_mut().push(code_usage());
                }
                Ok(vec![])
            }),
        );
        let instance = machine.load(BUSY, &[("host", &host)]);
        assert_eq!(machine.invoke(instance, "f", &[1000]), Ok(vec![1000]));
        assert_eq!(code_usage(), seen.borrow()[1]);
        clear_dead_stack();
        machine.collect(false);
        assert!(code_usage() < seen.borrow()[1]);
        assert_eq!(machine.invoke(instance, "f", &[1000]), Ok(vec![1000]));
    });
}

fn every_thread_has_to_let_go() {
    let engine = tiering(false, baseline_without_counters);
    let module = compile(engine, BUSY);
    let step = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        spawn(scope, engine, 256 << 10, |machine| {
            let step = Arc::clone(&step);
            let host = machine.host_function(
                None,
                Rc::new(move |machine, _, _| {
                    step.wait();
                    step.wait();
                    machine.collect(false);
                    step.wait();
                    step.wait();
                    Ok(vec![])
                }),
            );
            let instance = machine.instantiate(&module, &by_field(&[("host", &host)]));
            assert_eq!(machine.invoke(instance.unwrap(), "f", &[1]), Ok(vec![1]));
        });
        with_machine(engine, |machine| {
            let host = nothing(machine);
            let instance = machine
                .instantiate(&module, &by_field(&[("host", &host)]))
                .unwrap();
            step.wait();
            for _ in 0..200 {
                machine.invoke(instance, "f", &[1]).unwrap();
            }
            let replaced = code_usage();
            clear_dead_stack();
            machine.collect(false);
            assert_eq!(code_usage(), replaced);
            step.wait();
            step.wait();
            // That of the leaf is gone. The other thread is about to return to the rest.
            assert!(code_usage() < replaced);
            step.wait();
        });
    });
}

fn a_module_is_dropped_while_it_is_optimized() {
    static STEP: Barrier = Barrier::new(2);
    let optimizer: Optimizer = |compilers, env, code, loop_entry, feedback| {
        STEP.wait();
        STEP.wait();
        baseline_without_counters(compilers, env, code, loop_entry, feedback)
    };
    let engine = tiering(true, optimizer);
    let before = usage();
    with_machine(engine, |machine| {
        let instance = machine.load(r#"(func (export "f"))"#, &[]);
        (0..100).for_each(|_| drop(machine.invoke(instance, "f", &[])));
        STEP.wait();
    });
    STEP.wait();
    assert_eq!(usage(), before);
}

fn memory_type(maximum: Option<u64>, shared: bool) -> MemoryType {
    MemoryType {
        address: Width::W32,
        pages: Limits {
            initial: 1,
            maximum,
        },
        shared,
    }
}

fn a_shared_memory_goes_with_the_last_thread(engine: &'static Engine) {
    let before = usage();
    let (send, receive) = mpsc::channel();
    with_machine(engine, |machine| {
        let memory = machine.new_memory(memory_type(Some(2), true)).unwrap();
        memory.write(5, &[6]).unwrap();
        send.send(memory.share().unwrap()).unwrap();
    });
    let shared = receive.recv().unwrap();
    with_machine(engine, |machine| {
        let mut byte = [0];
        machine.adopt_memory(shared).read(5, &mut byte).unwrap();
        assert_eq!(byte, [6]);
        assert_ne!(usage(), before);
    });
    assert_eq!(usage(), before);
}

fn address_space_runs_short(engine: &'static Engine) {
    let before = usage();
    with_machine(engine, |machine| {
        machine.collect_every(u32::MAX);
        let new = |shared| {
            machine
                .new_memory(memory_type(Some(0x1_0000), shared))
                .unwrap()
        };
        let guarded = (0..)
            .take_while(|_| new(false).mode() == MemoryMode::Guarded)
            .count();
        assert!(guarded < 200);
        let forced = || {
            machine
                .urgencies
                .borrow()
                .iter()
                .filter(|&&it| it == Urgency::Now)
                .count()
        };
        assert!(machine.urgencies.borrow().contains(&Urgency::Soon));
        assert_eq!(forced(), 1);
        (0..100).for_each(|_| drop(new(false)));
        assert!(forced() <= 8);
        assert_eq!(new(true).mode(), MemoryMode::Checked);

        let source = r#"(memory 1)
            (func (export "f") (result i32)
                (i32.store (i32.const 8) (i32.const 3))
                (drop (memory.grow (i32.const 1)))
                (i32.store (i32.const 65536) (i32.const 4))
                (i32.add (i32.load (i32.const 8)) (i32.load (i32.const 65536))))"#;
        let instance = machine.load(source, &[]);
        let memory = instance.memory(MemoryIndex(0));
        let first_pages = memory.pages();
        let mut places = vec![first_pages.base()];
        for _ in 0..100 {
            assert_eq!(machine.invoke(instance, "f", &[]), Ok(vec![7]));
            places.push(memory.pages().base());
        }
        places.dedup();
        assert!((3..10).contains(&places.len()), "{}", places.len());
        // SAFETY: whoever keeps the pages may go on using them.
        assert_eq!(unsafe { first_pages.base().add(8).read() }, 3);

        machine.unroot_all();
        clear_dead_stack();
        let recovers = (0..200).any(|_| new(false).mode() == MemoryMode::Guarded);
        assert!(recovers);
    });
    assert_eq!(usage(), before);
}

#[cfg(all(target_os = "linux", not(bun_asan)))]
fn the_system_refuses(engine: &'static Engine) {
    use bun_engine_wasm_runtime::{GrowError, Memory};

    let with_limit = |resource, test: &dyn Fn()| {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: the pointers are valid.
        unsafe {
            libc::getrlimit(resource, &raw mut limit);
            let low = libc::rlimit {
                rlim_cur: 1,
                ..limit
            };
            libc::setrlimit(resource, &raw const low);
            test();
            libc::setrlimit(resource, &raw const limit);
        }
    };
    with_machine(engine, |machine| {
        let memory = machine.new_memory(memory_type(None, false)).unwrap();
        machine.urgencies.borrow_mut().reserve(10);
        machine.collect(false);
        let before = memory_usage();
        with_limit(libc::RLIMIT_DATA, &|| {
            // An emulator may ignore limits.
            if let Err(error) = memory.grow(1000) {
                assert_eq!((error, memory.page_count()), (GrowError::OutOfMemory, 1));
                assert_eq!(memory_usage(), before);
            }
        });
        let before = memory_usage();
        with_limit(libc::RLIMIT_AS, &|| {
            for shared in [false, true] {
                let ty = memory_type(Some(9), shared);
                drop(Memory::new(machine.store(), ty, MemoryMode::Guarded));
            }
        });
        assert_eq!(memory_usage(), before);
        assert!(memory.grow(1).is_ok());
    });
}

#[test]
fn nothing_is_left_behind() {
    let without_faults = engine(Options {
        handle_faults: false,
        ..options()
    });
    let engines = [
        engine(options()),
        without_faults,
        tiering(false, baseline_without_counters),
        tiering(true, baseline_without_counters),
    ];
    // The host makes its own stubs when it first calls.
    with_machine(engines[0], |machine| machine.collect(false));
    for engine in engines {
        all_goes_with_the_thread(engine);
        all_goes_with_the_instance(engine);
        a_shared_memory_goes_with_the_last_thread(engine);
        #[cfg(all(target_os = "linux", not(bun_asan)))]
        the_system_refuses(engine);
    }
    replaced_code_stays_while_it_is_on_a_stack();
    every_thread_has_to_let_go();
    a_module_is_dropped_while_it_is_optimized();
    address_space_runs_short(engines[0]);
}
