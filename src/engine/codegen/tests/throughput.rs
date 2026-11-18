//! How fast a function of the kind that speculation on a dynamic language gives is built and compiled.
//! `cargo test --release -p bun_engine_codegen --test throughput -- --ignored --nocapture`

#![allow(clippy::disallowed_macros, clippy::disallowed_methods)]

mod support;

use std::time::Instant;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Features, Options as AssemblerOptions, Target};
use bun_engine_codegen::ir::*;
use bun_engine_codegen::passes::{Analyses, Level, Pass};
use bun_engine_codegen::{CallSite, Client, Compiler, ExitSite, Frame, Options, PatchpointSite};
use support::generator::{Shape, generate};
use support::harness::{pass_named, setting};
use support::memory::Layout;
use support::random::Random;

struct Plain;

impl Client<MacroAssembler> for Plain {
    fn prologue(&mut self, masm: &mut MacroAssembler, _: usize, frame: &Frame) {
        masm.enter_frame();
        masm.sub64(abi::STACK_POINTER, abi::STACK_POINTER, frame.size);
    }
    fn shared_exit(&mut self, _: &mut MacroAssembler, _: Token) -> Option<Label> {
        None
    }
    fn exit(&mut self, masm: &mut MacroAssembler, _: &ExitSite<'_>) {
        masm.call_address(0x1000);
    }
    fn patchpoint(&mut self, _: &mut MacroAssembler, _: &PatchpointSite<'_>) {}
    fn after_call(&mut self, _: &mut MacroAssembler, _: &CallSite<'_>) {}
    fn out_of_line(&mut self, _: &mut MacroAssembler) {}
}

const VARIABLES: usize = 12;

struct Source<'a> {
    b: Builder<'a>,
    variables: [Value; VARIABLES],
    random: u64,
    exits: u32,
}

impl Source<'_> {
    fn pick(&mut self) -> usize {
        self.random = self
            .random
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (self.random >> 33) as usize % VARIABLES
    }

    fn exit(&mut self, state: State) -> Exit {
        self.exits += 1;
        Exit {
            token: Token(self.exits),
            state,
        }
    }

    fn unbox_int(&mut self, value: Value, state: State) -> Value {
        let tag = self.b.pinned(abi::NUMBER_TAG);
        let (is_not_int, exit) = (self.b.below(value, tag), self.exit(state));
        self.b.check(is_not_int, exit);
        self.b.wrap(value)
    }

    fn get_field(&mut self) {
        let (from, to) = (self.pick(), self.pick());
        let (object, state) = (self.variables[from], self.b.add_state(&self.variables));
        let mask = self.b.pinned(abi::NOT_CELL_MASK);
        let (is_not_cell, exit) = (self.b.and(object, mask), self.exit(state));
        self.b.check(is_not_cell, exit);
        let shape = self.b.load(Type::I32, object, 0, Heap::EVERYTHING);
        let (differs, exit) = (self.b.not_equal(shape, 1000 + to as i32), self.exit(state));
        self.b.check(differs, exit);
        self.variables[to] = self
            .b
            .load(Type::I64, object, 16 + 8 * to as i32, Heap::EVERYTHING);
    }

    fn add(&mut self) {
        let (lhs, rhs, to) = (self.pick(), self.pick(), self.pick());
        let state = self.b.add_state(&self.variables);
        let (lhs, rhs) = (
            self.unbox_int(self.variables[lhs], state),
            self.unbox_int(self.variables[rhs], state),
        );
        let exit = self.exit(state);
        let sum = self.b.checked(Checked::Add, lhs, rhs, exit);
        let (wide, tag) = (self.b.zero_extend(sum), self.b.pinned(abi::NUMBER_TAG));
        self.variables[to] = self.b.or(wide, tag);
    }

    fn call(&mut self, clobbers: RegisterSet, argument: Value) -> Value {
        let mut data = PatchpointData::new(
            Action::Call(Target::Address(0x2000)),
            Token(0),
            Effects::CALL,
        );
        data.clobbers_late = clobbers
            - abi::PINNED
            - RegisterSet::of(&[abi::STACK_POINTER, abi::FRAME_POINTER], &[]);
        data.state = self.b.add_state(&self.variables);
        let vm = self.b.pinned(abi::VM);
        let operands = [
            (vm, Input::Fixed(abi::ARGUMENT_GPRS[0].into())),
            (argument, Input::Fixed(abi::ARGUMENT_GPRS[1].into())),
        ];
        self.b.patchpoint(
            &data,
            &operands,
            &[(Type::I64, Output::Fixed(abi::RETURN_GPRS[0].into()))],
        )
    }

    fn fast_and_slow_path(&mut self) {
        let (from, to) = (self.pick(), self.pick());
        let (slow, done) = (self.b.new_block(), self.b.new_block());
        let result = self.b.add_param(done, Type::I64);
        let cached = self
            .b
            .load(Type::I64, self.variables[from], 8, Heap::EVERYTHING);
        self.b
            .branch(cached, Successor::new(done, &[cached]), slow.rare());
        self.b.switch_to(slow);
        let computed = self.call(abi::CALLER_SAVED, self.variables[from]);
        self.b.jump(done, &[computed]);
        self.b.switch_to(done);
        self.variables[to] = result;
    }

    fn join(&mut self, block: Block) -> [Value; VARIABLES] {
        core::array::from_fn(|_| self.b.add_param(block, Type::I64))
    }

    fn statements(&mut self, count: usize, depth: usize) {
        for _ in 0..count {
            match self.pick() {
                0..4 => self.get_field(),
                4..7 => self.add(),
                7 | 8 => self.fast_and_slow_path(),
                9 => {
                    let (from, to) = (self.pick(), self.pick());
                    self.variables[to] = self.call(abi::ALL, self.variables[from]);
                }
                10 if depth < 2 => {
                    let (then, done, from) = (self.b.new_block(), self.b.new_block(), self.pick());
                    let (to, before) = (self.pick(), self.variables);
                    let merged = self.b.add_param(done, Type::I64);
                    let condition = self.b.equal(before[from], 7);
                    self.b
                        .branch(condition, then, Successor::new(done, &[before[to]]));
                    self.b.switch_to(then);
                    self.statements(3, depth + 1);
                    self.b.jump(done, &[self.variables[to]]);
                    self.b.switch_to(done);
                    self.variables = before;
                    self.variables[to] = merged;
                }
                11 if depth < 2 => {
                    let (body, done, from) = (self.b.new_block(), self.b.new_block(), self.pick());
                    let params = self.join(body);
                    self.b.jump(body, &self.variables);
                    self.b.switch_to(body);
                    self.variables = params;
                    self.statements(4, depth + 1);
                    let condition = self.b.equal(self.variables[from], 7);
                    self.b
                        .branch(condition, Successor::new(body, &self.variables), done);
                    self.b.switch_to(done);
                }
                _ => self.add(),
            }
        }
    }
}

fn build(function: &mut Function, statements: usize) {
    function.clear(abi::PINNED);
    function.set_results(&[Boundary::Register(abi::RETURN_GPRS[0].into())]);
    let params: Vec<_> = (0..VARIABLES as i32)
        .map(|n| (Type::I64, Boundary::Frame(48 + 8 * n)))
        .collect();
    let entry = function.add_entry(&params);
    let variables = function.params(entry).try_into().unwrap();
    let mut source = Source {
        b: Builder::at_end(function, entry),
        variables,
        random: 1,
        exits: 0,
    };
    source.statements(statements, 0);
    source.b.ret(&[source.variables[0]]);
}

#[test]
#[ignore = "a measurement"]
fn nanoseconds_per_value() {
    let seconds: f64 = std::env::var("SECONDS").map_or(0.5, |text| text.parse().unwrap());
    let (mut function, mut compiler) = (Function::new(abi::PINNED), Compiler::default());
    for (level, shorten_jumps) in [
        (Level::Quick, false),
        (Level::Quick, true),
        (Level::Full, true),
    ] {
        for statements in [10, 100, 1000] {
            if std::env::var("ONLY")
                .is_ok_and(|only| only != format!("{level:?}-{shorten_jumps}-{statements}"))
            {
                continue;
            }
            let (start, mut rounds, mut building, mut bytes, mut values) =
                (Instant::now(), 0, 0.0, 0, 0);
            while start.elapsed().as_secs_f64() < seconds {
                let before = Instant::now();
                build(&mut function, statements);
                building += before.elapsed().as_secs_f64();
                values = function.value_count();
                let mut masm = MacroAssembler::new(AssemblerOptions {
                    features: Features::host(),
                    shorten_jumps,
                    seed: 0,
                });
                compiler
                    .compile(
                        &mut function,
                        Options {
                            level,
                            records_origins: false,
                        },
                        &mut masm,
                        &mut Plain,
                    )
                    .unwrap();
                let code = masm.finish().unwrap();
                bytes = code.bytes().len();
                if let (0, Ok(path)) = (rounds, std::env::var("CODE_DUMP")) {
                    std::fs::write(format!("{path}.{level:?}.{statements}"), code.bytes()).unwrap();
                }
                rounds += 1;
            }
            let per_value = |seconds: f64| seconds * 1e9 / f64::from(rounds) / values as f64;
            let total = start.elapsed().as_secs_f64();
            println!(
                "{level:?} shorten {shorten_jumps}: {values} values, {} blocks, {bytes} bytes: build {:.1} ns, compile {:.1} ns per value, {:.1} us in all",
                function.block_count(),
                per_value(building),
                per_value(total - building),
                total * 1e6 / f64::from(rounds),
            );
        }
    }
}

fn measure_passes(title: &str, functions: &[Function]) {
    if std::env::var("ONLY").is_ok_and(|only| only != title) {
        return;
    }
    let seconds: f64 = std::env::var("SECONDS").map_or(0.5, |text| text.parse().unwrap());
    let chosen = setting("PASSES").map(|names| names.split(',').map(pass_named).collect());
    let passes: Vec<&Pass> = chosen.unwrap_or_else(|| Pass::pipeline(Level::Full).iter().collect());
    let size = |function: &Function| -> usize {
        let of_block = |block| function.params(block).len() + function.instructions(block).count();
        function.blocks().map(of_block).sum()
    };
    let (mut best, mut analyses) = (vec![[f64::INFINITY; 2]; passes.len()], Analyses::default());
    let (start, mut sizes) = (Instant::now(), Vec::new());
    while start.elapsed().as_secs_f64() < seconds {
        let mut times = vec![[0.0; 2]; passes.len()];
        sizes = vec![[0; 2]; passes.len()];
        for function in functions {
            let mut function = function.clone();
            function.reserve_values(function.value_count());
            analyses.invalidate();
            for ((pass, time), sizes) in passes.iter().zip(&mut times).zip(&mut sizes) {
                sizes[0] += size(&function);
                let first = Instant::now();
                analyses.dominators(&mut function);
                let second = Instant::now();
                pass.run(
                    &mut function,
                    &mut analyses,
                    bun_engine_codegen::Target::host(),
                );
                time[1] += second.elapsed().as_secs_f64();
                time[0] += (second - first).as_secs_f64();
                sizes[1] += size(&function);
            }
        }
        for (best, time) in best.iter_mut().flatten().zip(times.into_iter().flatten()) {
            *best = best.min(time);
        }
    }
    println!("{title}, nanoseconds per value for dominators and the pass, values before and after");
    for ((pass, best), [before, after]) in passes.iter().zip(best).zip(sizes) {
        let [analysing, running] = best.map(|time| time * 1e9 / before as f64);
        let name = pass.name;
        println!("    {name:28} {analysing:6.1} {running:6.1} {before:8} {after:8}");
    }
}

#[test]
#[ignore = "a measurement"]
fn nanoseconds_per_value_of_each_pass() {
    for statements in [30, 1000] {
        let mut function = Function::new(abi::PINNED);
        build(&mut function, statements);
        measure_passes(&format!("{statements} statements"), &[function]);
    }
    for (profile, size) in [
        ("memory", 40),
        ("loops", 40),
        ("everything", 40),
        ("everything", 3000),
    ] {
        let generate_one = |seed| {
            let shape = Shape::of_profile(profile, &mut Random::new(seed));
            let (shape, target) = (Shape { size, ..shape }, bun_engine_codegen::Target::host());
            generate(seed, &shape, target, &Layout::default()).function
        };
        let functions: Vec<Function> = (0..u64::from(6000 / size)).map(generate_one).collect();
        measure_passes(&format!("random programs, {profile} {size}"), &functions);
    }
}
