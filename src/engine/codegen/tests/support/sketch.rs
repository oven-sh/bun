//! For tests that build their own functions.

use bun_engine_asm::{RegisterSet, X64Features};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{Block, Boundary, Function, Op, Type, Value};
use bun_engine_codegen::passes::Analyses;

use super::generator::{Class, Program};
use super::harness::{Case, World, pass_named};
use super::random::Random;
use super::vocabulary::registers;

pub(crate) const TARGET: Target = Target::X64(X64Features::all());

/// Returns one I64.
pub(crate) fn empty_function() -> Function {
    let mut function = Function::new(RegisterSet::of(&registers(TARGET).pinned, &[]));
    function.set_results(&[Boundary::Frame(16)]);
    function
}

/// At most eight parameters.
pub(crate) fn add_entry(function: &mut Function, types: &[Type]) -> (Block, Vec<Value>) {
    let place = |(position, &ty): (i32, &Type)| (ty, Boundary::Frame(16 + 16 * position));
    let params: Vec<_> = (0..).zip(types).map(place).collect();
    let entry = function.add_entry(&params);
    (entry, function.params(entry).to_vec())
}

pub(crate) fn run_passes(function: &mut Function, names: &[&str]) {
    let mut analyses = Analyses::default();
    for name in names {
        pass_named(name).run(function, &mut analyses, TARGET);
    }
}

/// `inputs` are the number of an entry and its arguments.
pub(crate) fn case(function: &Function, inputs: &[(usize, Vec<u128>)]) -> Case {
    let world = World {
        target: TARGET,
        ..World::imaginary(0)
    };
    let classes = |block| {
        let params = function.params(block).iter();
        params
            .map(|&param| Class::Data(function.type_of(param)))
            .collect()
    };
    let entries = function.entries().iter();
    let program = Program {
        function: function.clone(),
        target: TARGET,
        params: entries.map(|entry| classes(entry.block)).collect(),
        remarkable: vec![0],
    };
    let mut random = Random::new(0);
    let inputs = inputs.iter().map(|(entry, args)| {
        let mut input = program.input(&world.layout, &mut random);
        (input.entry, input.args) = (*entry, args.clone());
        input
    });
    let inputs = inputs.collect();
    Case::new(0, world.clone(), program, inputs)
        .unwrap_or_else(|problem| panic!("{problem}\n{function:?}"))
}

pub(crate) fn assert_same(case: &Case, function: &Function) {
    if let Err(problem) = case.check(function) {
        panic!(
            "{problem}\nbefore:\n{:?}\nafter:\n{function:?}",
            case.program.function
        );
    }
}

pub(crate) fn count(function: &Function, is_wanted: impl Fn(&Op) -> bool) -> usize {
    let instructions = function
        .blocks()
        .flat_map(|block| function.instructions(block));
    instructions
        .filter(|&value| is_wanted(function.op(value)))
        .count()
}
