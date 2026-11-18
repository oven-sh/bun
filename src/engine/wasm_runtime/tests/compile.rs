#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::clone_on_ref_ptr
)]

mod support;

use std::sync::mpsc;

use bun_engine_wasm_format::CodeIndex;
use bun_engine_wasm_runtime::{
    CompileError, Compiled, Engine, Options, StreamingCompiler, wait_for_background_work,
};
use support::text::assemble;
use support::{by_field, engine, options, with_machine};

const FUNCTIONS: u32 = 1500;

/// About a megabyte.
fn module(invalid: &[u32]) -> Vec<u8> {
    let padding = "v128.const i64x2 0 0 drop ".repeat(36);
    let function = |n| {
        let ty = if invalid.contains(&n) { "i64" } else { "i32" };
        format!(r#"(func (export "{n}") (result i32) {padding} ({ty}.const {n}))"#)
    };
    assemble(&(0..FUNCTIONS).map(function).collect::<Vec<_>>().concat())
}

fn in_background(engine: &'static Engine, bytes: &[u8]) -> Compiled {
    let (send, receive) = mpsc::channel();
    engine.compile_in_background(bytes.to_vec(), || true, move |it| send.send(it).unwrap());
    receive.recv().unwrap()
}

fn streaming(engine: &'static Engine, bytes: &[u8], piece: usize) -> Compiled {
    let (send, receive) = mpsc::channel();
    let mut compiler = StreamingCompiler::new(engine);
    for piece in bytes.chunks(piece) {
        let _ = compiler.feed(piece);
    }
    compiler
        .finish()?
        .validate(move |it| send.send(it).unwrap());
    receive.recv().unwrap()
}

fn all_ways(bytes: &[u8]) -> Vec<Compiled> {
    let ways = |use_threads| {
        let engine = engine(Options {
            use_threads,
            ..options()
        });
        [
            engine.compile(bytes.to_vec()),
            in_background(engine, bytes),
            streaming(engine, bytes, 997),
            streaming(engine, bytes, 70_000),
            streaming(engine, bytes, bytes.len()),
        ]
    };
    [false, true].into_iter().flat_map(ways).collect()
}

#[test]
fn all_ways_lead_to_the_module() {
    for module in all_ways(&module(&[])) {
        let module = module.unwrap();
        with_machine(module.engine(), |machine| {
            let instance = machine.instantiate(&module, &by_field(&[])).unwrap();
            for n in [0, 777, FUNCTIONS - 1] {
                assert_eq!(
                    machine.invoke(instance, &n.to_string(), &[]),
                    Ok(vec![n.into()])
                );
            }
        });
    }
    assert!(all_ways(&assemble("")).iter().all(Result::is_ok));
}

#[test]
fn the_first_error_is_reported() {
    for invalid in [&[0, 1][..], &[700, 760, 1499], &[1499]] {
        for outcome in all_ways(&module(invalid)) {
            let Err(CompileError::Invalid(error)) = outcome else {
                panic!()
            };
            assert_eq!(error.function(), Some(CodeIndex(invalid[0])));
        }
    }
    let mut truncated = module(&[3]);
    truncated.pop();
    let mut extended = module(&[3]);
    extended.push(0x7f);
    for bytes in [truncated, extended] {
        let errors: Vec<_> = all_ways(&bytes)
            .into_iter()
            .map(|it| it.err().unwrap())
            .collect();
        assert!(matches!(&errors[0], CompileError::Invalid(it) if it.function().is_none()));
        assert!(errors.iter().all(|it| *it == errors[0]));
    }
}

#[test]
fn many_branches_carry_many_values() {
    let (values, branches) = (400, 10_000);
    let source = format!(
        r#"(func (export "f") (param $n i32) (result i32) (local $x i32)
            (local.set $x (i32.add (local.get $n) (i32.const 1)))
            {carried}
            (block (param {types}) (result {types}) {branch})
            {drops})"#,
        types = "i32 ".repeat(values),
        carried = "(local.get $x) ".repeat(values),
        branch = "(br_if 0 (local.get $n)) ".repeat(branches),
        drops = "(drop) ".repeat(values - 1)
    );
    with_machine(engine(options()), |machine| {
        let instance = machine.load(&source, &[]);
        for n in [0, 1] {
            assert_eq!(machine.invoke(instance, "f", &[n]), Ok(vec![n + 1]));
        }
    });
}

#[test]
fn a_stream_is_given_up() {
    let bytes = module(&[]);
    let mut compiler = StreamingCompiler::new(engine(options()));
    compiler.feed(&bytes[..bytes.len() / 2]).unwrap();
    drop(compiler);
    wait_for_background_work();
}
