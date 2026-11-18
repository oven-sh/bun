//! The baseline compiler stands in for the optimizing one.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::rc::Rc;
use std::sync::{Barrier, Mutex};

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{CodeIndex, FuncIndex};
use bun_engine_wasm_runtime::{
    Engine, Instance, Optimizer, Options, Tiering, wait_for_background_work,
};
use support::machine::Failure;
use support::{baseline_without_counters, engine, options, with_machine};

type Request = (u32, Option<u32>);

/// An optimizer that writes down what it is asked for, and refuses what `$refuses` names.
macro_rules! recording {
    ($refuses:expr) => {{
        static REQUESTS: Mutex<Vec<Request>> = Mutex::new(Vec::new());
        let optimizer: Optimizer = |compilers, env, code, loop_entry, feedback| {
            REQUESTS.lock().unwrap().push((code.0, loop_entry));
            let refuses: fn(Request) -> bool = $refuses;
            if refuses((code.0, loop_entry)) {
                return None;
            }
            baseline_without_counters(compilers, env, code, loop_entry, feedback)
        };
        (optimizer, || std::mem::take(&mut *REQUESTS.lock().unwrap()))
    }};
}

fn tiering(threshold: u32, use_threads: bool, optimizer: Optimizer) -> &'static Engine {
    engine(Options {
        tiering: Tiering::After(threshold),
        use_threads,
        optimizer,
        ..options()
    })
}

fn entry_of(instance: &Instance, func: u32) -> usize {
    let slot = instance.callable(FuncIndex(func)).slot;
    // SAFETY: the entry is the first word of the slot.
    unsafe { std::ptr::with_exposed_provenance::<usize>(slot).read_volatile() }
}

/// Counts `$n` down in the loop `$name`, around `body`.
fn counted_loop(name: &str, times: &str, body: &str) -> String {
    format!(
        "(local.set ${name} {times})
        (loop ${name} {body}
            (br_if ${name} (local.tee ${name} (i32.sub (local.get ${name}) (i32.const 1)))))"
    )
}

const COUNT: &str = "(local.set $sum (i32.add (local.get $sum) (i32.const 1)))";

fn function(body: &str) -> String {
    format!(
        r#"(func (export "f") (param $x i32) (param $y i32) (param $z i32) (result i32)
        (local $sum i32) (local $a i32) (local $b i32) (local $c i32) {body} (local.get $sum))"#
    )
}

fn three_deep() -> String {
    let inner = counted_loop("c", "(local.get $z)", COUNT);
    let middle = counted_loop("b", "(local.get $y)", &inner);
    function(&counted_loop("a", "(local.get $x)", &middle))
}

#[test]
fn calls_make_a_function_hot() {
    let (optimizer, requests) = recording!(|_| false);
    for use_threads in [false, true] {
        with_machine(tiering(1500, use_threads, optimizer), |machine| {
            let padding = "nop ".repeat(200);
            let source = format!(
                r#"(func (export "large") (result i32) {padding} (i32.const 1))
                (func (export "small") (result i32) (i32.const 2))"#
            );
            let instance = machine.load(&source, &[]);
            for (name, func, calls) in [("large", 0, 100), ("small", 1, 1500)] {
                let call = || machine.invoke(instance, name, &[]).unwrap();
                call();
                let baseline = entry_of(instance, func);
                (2..calls).for_each(|_| drop(call()));
                wait_for_background_work();
                assert_eq!((requests(), entry_of(instance, func)), (vec![], baseline));
                call();
                wait_for_background_work();
                assert_eq!(requests(), [(func, None)]);
                assert_ne!(entry_of(instance, func), baseline);
                assert_eq!(call(), [func as u128 + 1]);
            }
        });
    }
}

#[test]
fn entries_and_loops_add_up() {
    let (optimizer, requests) = recording!(|_| false);
    with_machine(tiering(1000, false, optimizer), |machine| {
        let turn = |name| counted_loop(name, "(local.get $x)", COUNT);
        let source = function(&[turn("a"), turn("b"), turn("c")].concat());
        let instance = machine.load(&source, &[]);
        let calls = (1..).find(|_| {
            machine.invoke(instance, "f", &[10, 0, 0]).unwrap();
            requests() == [(0, None)]
        });
        // About 40 a call, noticed when one of the four has counted another 250.
        assert!((23..=40).contains(&calls.unwrap()), "{calls:?}");
    });
}

#[test]
fn a_long_loop_is_entered_at_the_outermost_that_turns() {
    let (optimizer, requests) = recording!(|_| false);
    let cases = [
        ([1000, 3, 3], 0),
        ([1, 1000, 3], 1),
        ([1, 1, 5000], 2),
        ([3, 3, 5000], 2),
        ([2, 5000, 10], 1),
    ];
    for (turns, expected) in cases {
        with_machine(tiering(400, false, optimizer), |machine| {
            let instance = machine.load(&three_deep(), &[]);
            let sum = turns.iter().product();
            assert_eq!(machine.invoke(instance, "f", &turns), Ok(vec![sum]));
            assert_eq!(requests(), [(0, Some(expected))], "{turns:?}");
            // Only now it pays to have code for the start.
            assert_eq!(machine.invoke(instance, "f", &[1, 1, 1]), Ok(vec![1]));
            assert_eq!(requests(), [(0, None)]);
        });
    }
}

#[test]
fn a_function_that_is_often_called_is_replaced_first() {
    let (optimizer, requests) = recording!(|_| false);
    with_machine(tiering(400, false, optimizer), |machine| {
        let instance = machine.load(&three_deep(), &[]);
        for _ in 0..5 {
            machine.invoke(instance, "f", &[1, 1, 1]).unwrap();
        }
        assert_eq!(machine.invoke(instance, "f", &[1, 1, 5000]), Ok(vec![5000]));
        assert_eq!(requests(), [(0, None), (0, Some(2))]);
    });
}

#[test]
fn what_is_refused_is_not_asked_for_again() {
    let (optimizer, requests) = recording!(|_| true);
    with_machine(tiering(400, false, optimizer), |machine| {
        let instance = machine.load(&three_deep(), &[]);
        assert_eq!(
            machine.invoke(instance, "f", &[1000, 10, 10]),
            Ok(vec![100_000])
        );
        let mut asked = requests();
        asked.sort_unstable();
        assert_eq!(asked, [(0, Some(0)), (0, Some(1)), (0, Some(2))]);
        for _ in 0..100 {
            machine.invoke(instance, "f", &[10, 10, 10]).unwrap();
        }
        assert_eq!(requests(), [(0, None)]);
    });
}

#[test]
fn an_inner_loop_does_not_wait_for_ever() {
    let (optimizer, requests) = recording!(|request| request == (0, Some(0)));
    with_machine(tiering(400, false, optimizer), |machine| {
        let instance = machine.load(&three_deep(), &[]);
        assert_eq!(machine.invoke(instance, "f", &[1000, 3, 3]), Ok(vec![9000]));
        assert!(matches!(requests()[..], [(0, Some(0)), (0, Some(1 | 2))]));
    });
}

#[test]
fn loops_are_entered_while_they_run() {
    let (optimizer, requests) = recording!(|_| false);
    with_machine(tiering(100, true, optimizer), |machine| {
        let wait = machine.host_function(
            None,
            Rc::new(|_, _, _| {
                wait_for_background_work();
                Ok(vec![])
            }),
        );
        let body = counted_loop("a", "(local.get $x)", &format!("{COUNT} (call $wait)"));
        let source = format!(r#"(import "" "wait" (func $wait)) {}"#, function(&body));
        let instance = machine.load(&source, &[("wait", &wait)]);
        assert_eq!(machine.invoke(instance, "f", &[1000, 0, 0]), Ok(vec![1000]));
        assert_eq!(requests(), [(0, Some(0))]);
    });
}

#[test]
fn one_loop_is_compiled_at_a_time() {
    static MAY_FINISH: Barrier = Barrier::new(2);
    let (optimizer, requests) = recording!(|_| {
        MAY_FINISH.wait();
        false
    });
    with_machine(tiering(40, true, optimizer), |machine| {
        let instance = machine.load(&three_deep(), &[]);
        assert_eq!(machine.invoke(instance, "f", &[100, 3, 3]), Ok(vec![900]));
        MAY_FINISH.wait();
        wait_for_background_work();
        assert_eq!(requests(), [(0, Some(0))]);
    });
}

#[test]
fn handlers_and_traces_survive_the_change() {
    let (optimizer, requests) = recording!(|_| false);
    with_machine(tiering(40, false, optimizer), |machine| {
        let turn = "(block $caught (try_table (catch_all $caught) (call $throw)))";
        let body = counted_loop("a", "(local.get $x)", &format!("{COUNT} {turn}"));
        let check = "(if (local.get $y) (then (call $trap)))";
        let source = format!(
            "(tag $tag) (func $throw (throw $tag)) (func $trap unreachable) {}",
            function(&format!("{body} {check}"))
        );
        let instance = machine.load(&source, &[]);
        let trapped = machine.invoke(instance, "f", &[500, 1, 0]);
        assert_eq!(trapped, Err(Failure::Trap(Trap::Unreachable)));
        assert_eq!(*machine.stack_trace.borrow(), [1, 2]);
        assert!(requests().contains(&(2, Some(0))));
        assert_eq!(machine.invoke(instance, "f", &[500, 0, 0]), Ok(vec![500]));
    });
}

#[test]
fn without_baseline_code() {
    let (optimizer, requests) = recording!(|request| request == (1, None));
    let optimized_only = engine(Options {
        tiering: Tiering::OptimizedOnly,
        optimizer,
        ..options()
    });
    with_machine(optimized_only, |machine| {
        let instance = machine.load(
            r#"(func (export "f") (result i32) (i32.add (call $g) (call $h)))
            (func $g (result i32) (i32.const 1)) (func $h (result i32) (i32.const 2))"#,
            &[],
        );
        for _ in 0..3 {
            assert_eq!(machine.invoke(instance, "f", &[]), Ok(vec![3]));
        }
        assert_eq!(requests(), [(0, None), (1, None), (2, None)]);
    });
}

#[test]
fn the_optimizer_learns_what_happened() {
    static SEEN: Mutex<Vec<(u32, u32, Vec<(CodeIndex, u32)>)>> = Mutex::new(Vec::new());
    let optimizer: Optimizer = |_, _, code, _, feedback| {
        if code.0 == 0 {
            let site = |site| {
                let call = feedback.call(code, site);
                (
                    feedback.entry_count(code),
                    call.count,
                    call.targets.to_vec(),
                )
            };
            SEEN.lock().unwrap().extend((0..5).map(site));
            assert_eq!(feedback.entry_count(CodeIndex(3)), 0);
            assert_eq!(feedback.call(CodeIndex(3), 0).count, 0);
        }
        None
    };
    with_machine(tiering(2000, false, optimizer), |machine| {
        let host = machine.host_function(None, Rc::new(|_, _, _| Ok(vec![])));
        let instance = machine.load(
            r#"(import "" "host" (func $host))
            (table 8 funcref) (elem (i32.const 0) func $a $b $c $host $d $d $a $c)
            (func (export "f") (param i32)
                (call $a)
                (call_indirect (i32.const 1))
                (call_indirect (i32.eqz (i32.and (local.get 0) (i32.const 3))))
                (call_indirect (i32.and (local.get 0) (i32.const 7)))
                (if (i32.eq (local.get 0) (i32.const -1)) (then (call $never))))
            (func $a) (func $b) (func $never (call $a)) (func $c) (func $d)"#,
            &[("host", &host)],
        );
        let calls = (0..).find(|&call| {
            machine.invoke(instance, "f", &[call]).unwrap();
            !SEEN.lock().unwrap().is_empty()
        });
        let completed = calls.unwrap() as u32;
        let share = |remainders: &[u32], of| {
            (0..completed)
                .filter(|it| remainders.contains(&(it % of)))
                .count() as u32
        };
        let [a, b, c] = [1, 2, 4].map(CodeIndex);
        let targets = [
            vec![],
            vec![(b, completed)],
            vec![(a, share(&[1, 2, 3], 4)), (b, share(&[0], 4))],
            vec![
                (a, share(&[0, 6], 8)),
                (c, share(&[2, 7], 8)),
                (b, share(&[1], 8)),
            ],
        ];
        let mut expected = targets.map(|it| (completed + 1, completed, it)).to_vec();
        expected.push((completed + 1, 0, vec![]));
        assert_eq!(*SEEN.lock().unwrap(), expected);
    });
}

#[test]
fn the_optimizer_learns_how_often_loops_turned() {
    static TURNS: Mutex<[u32; 3]> = Mutex::new([0; 3]);
    let optimizer: Optimizer = |_, _, code, _, feedback| {
        *TURNS.lock().unwrap() = [0, 1, 2].map(|index| feedback.loop_turns(code, index));
        None
    };
    with_machine(tiering(400, false, optimizer), |machine| {
        let instance = machine.load(&three_deep(), &[]);
        machine.invoke(instance, "f", &[300, 7, 5]).unwrap();
        machine.invoke(instance, "f", &[1, 1, 1]).unwrap();
        assert_eq!(*TURNS.lock().unwrap(), [300, 2100, 10_500]);
    });
}
