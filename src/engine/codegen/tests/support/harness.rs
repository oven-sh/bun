//! Campaigns over many seeds. `CODEGEN_FUZZ_` followed by
//!
//! - `SEED`: the first seed,
//! - `COUNT`: the number of seeds,
//! - `THREADS`,
//! - `PROFILE`: one of `generator::PROFILES`, which otherwise take turns,
//! - `SIZE`: the number of statements,
//! - `PASSES`: names with commas between them, to run just these in this order,
//! - `WITHOUT`: names with commas between them, to leave those passes out,
//! - `UNREDUCED`: set it to see a failing program as it was generated,
//! - `KEEP_GOING`: set it to get only the seed and a line for each failure.

use std::cell::{Cell, RefCell};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Once;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_engine_asm::{Arm64Features, Relaxed, X64Features};
use bun_engine_codegen::Target;
use bun_engine_codegen::analysis::Cfg;
use bun_engine_codegen::ir::{Function, Op, PatchpointFlags, validate};
use bun_engine_codegen::passes::{Analyses, Level, Pass};

use super::generator::{PROFILES, Program, Shape, generate};
use super::interpreter::{Interpreter, Mode, Options, Outcome, Run};
use super::memory::{Input, Layout};
use super::random::{Random, mix};
use super::reducer::reduce;

const FUEL: u64 = 200_000;

pub(crate) fn setting(name: &str) -> Option<String> {
    std::env::var(format!("CODEGEN_FUZZ_{name}")).ok()
}

pub(crate) fn number_setting(name: &str, default: u64) -> u64 {
    setting(name).map_or(default, |text| text.parse().expect("a number"))
}

/// What programs are made for and run on.
#[derive(Clone)]
pub(crate) struct World {
    pub(crate) layout: Layout,
    pub(crate) target: Target,
    pub(crate) relaxed: Relaxed,
    pub(crate) other_threads: bool,
}

impl World {
    /// For programs that are only interpreted.
    pub(crate) fn imaginary(seed: u64) -> Self {
        let mut random = Random::new(mix(seed, 1));
        let bits = random.next() as u16;
        Self {
            layout: Layout::default(),
            target: if random.flip() {
                Target::X64(X64Features::from_bits_truncate(bits))
            } else {
                Target::Arm64(Arm64Features::from_bits_truncate(bits))
            },
            relaxed: Relaxed::from_bits_truncate(random.next() as u8),
            other_threads: true,
        }
    }

    fn options(&self, mode: Mode, fuel: u64) -> Options {
        Options {
            mode,
            relaxed: self.relaxed,
            other_threads: self.other_threads,
            fuel,
        }
    }
}

/// A program, inputs, and what it may do on each.
#[derive(Clone)]
pub(crate) struct Case {
    pub(crate) seed: u64,
    pub(crate) world: World,
    pub(crate) program: Program,
    pub(crate) inputs: Vec<Input>,
    pub(crate) references: Vec<Run>,
    /// How many instructions run on some input, and how many there are.
    pub(crate) coverage: (usize, usize),
}

pub(crate) fn shape_for(seed: u64) -> Shape {
    let profile =
        setting("PROFILE").unwrap_or_else(|| PROFILES[seed as usize % PROFILES.len()].into());
    let mut shape = Shape::of_profile(&profile, &mut Random::new(mix(seed, 2)));
    shape.size = number_setting("SIZE", shape.size.into()) as u32;
    shape
}

impl Case {
    pub(crate) fn generate(seed: u64, shape: &Shape, world: &World) -> Self {
        let program = generate(seed, shape, world.target, &world.layout);
        let mut random = Random::new(mix(seed, 3));
        let runs_straight = shape.weights.loops + shape.weights.graphs == 0;
        let inputs = (0..if runs_straight { 12 } else { 5 })
            .map(|_| program.input(&world.layout, &mut random))
            .collect();
        let text = || {
            format!(
                "{:?}",
                generate(seed, shape, world.target, &world.layout).function
            )
        };
        Self::new(seed, world.clone(), program, inputs).unwrap_or_else(|problem| {
            panic!(
                "seed {seed} gives a bad program: {problem}\n{shape:?}\n{}",
                text()
            )
        })
    }

    /// Fails if the program is not valid or breaks a promise.
    pub(crate) fn new(
        seed: u64,
        world: World,
        program: Program,
        inputs: Vec<Input>,
    ) -> Result<Self, String> {
        Self::with_fuel(seed, world, program, inputs, FUEL)
    }

    fn with_fuel(
        seed: u64,
        world: World,
        program: Program,
        inputs: Vec<Input>,
        fuel: u64,
    ) -> Result<Self, String> {
        let function = &program.function;
        validate(function)?;
        let mut interpreter = Interpreter::new(&world.layout, world.target);
        interpreter.load(function);
        let mut references = Vec::new();
        for input in &inputs {
            let run = interpreter.run_to_end(function, input, world.options(Mode::Reference, fuel));
            if let Outcome::Undefined(reason) = run.outcome {
                return Err(format!(
                    "{reason} after {} steps on {:x?}",
                    run.steps, input.args
                ));
            }
            references.push(run);
        }
        let instructions = function
            .blocks()
            .flat_map(|block| function.instructions(block))
            .count();
        let coverage = (
            interpreter
                .has_run
                .iter()
                .filter(|&&has_run| has_run)
                .count(),
            instructions,
        );
        Ok(Self {
            seed,
            world,
            program,
            inputs,
            references,
            coverage,
        })
    }

    /// Also fails if the function takes much longer than the program.
    pub(crate) fn with_function(&self, function: Function) -> Result<Self, String> {
        let program = Program {
            function,
            target: self.program.target,
            params: self.program.params.clone(),
            remarkable: Vec::new(),
        };
        let steps = self.references.iter().map(|reference| reference.steps);
        let fuel = 4 * steps.max().unwrap_or(0) + 1000;
        let (world, inputs) = (self.world.clone(), self.inputs.clone());
        let case = Self::with_fuel(self.seed, world, program, inputs, fuel)?;
        let mut outcomes = case.references.iter().map(|reference| &reference.outcome);
        if outcomes.any(|outcome| *outcome == Outcome::OutOfFuel) {
            return Err("does not come to an end".into());
        }
        Ok(case)
    }

    /// Whether `function` does what the program may do.
    pub(crate) fn check(&self, function: &Function) -> Result<(), String> {
        validate(function)?;
        let mut interpreter = Interpreter::new(&self.world.layout, self.world.target);
        interpreter.load(function);
        for (index, (input, reference)) in self.inputs.iter().zip(&self.references).enumerate() {
            let options = self.world.options(
                Mode::Concrete(mix(self.seed, index as u64)),
                20 * reference.steps + 1000,
            );
            let outcome = interpreter.run(function, input, options);
            reference
                .check(
                    &outcome,
                    &interpreter.machine.trace,
                    &interpreter.machine.memory,
                )
                .map_err(|difference| {
                    format!(
                        "entry {}, arguments {:x?}: {difference}",
                        input.entry, input.args
                    )
                })?;
        }
        Ok(())
    }
}

/// What a campaign tests. Each thread has one of its own.
pub(crate) trait Subject {
    fn world(&mut self, seed: u64) -> World;

    fn shape(&mut self, seed: u64) -> Shape {
        shape_for(seed)
    }

    /// The error starts with a line that sums it up.
    fn test(&mut self, case: &Case) -> Result<(), String>;

    /// After a failure: a case that is nearer to the cause and fails from now on.
    fn narrow(&mut self, case: Case) -> Case {
        case
    }

    /// What helps to understand a failure and takes long to find out.
    fn describe(&mut self, _case: &Case) -> String {
        String::new()
    }
}

thread_local! {
    static IS_CATCHING: Cell<bool> = const { Cell::new(false) };
    static LAST_PANIC: RefCell<String> = const { RefCell::new(String::new()) };
}

/// Turns a panic into an error, and keeps quiet about it.
pub(crate) fn catching<T>(work: impl FnOnce() -> T) -> Result<T, String> {
    static HOOK: Once = Once::new();
    HOOK.call_once(|| {
        let usual = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if IS_CATCHING.get() {
                LAST_PANIC.set(info.to_string().replacen('\n', " ", 1));
            } else {
                usual(info);
            }
        }));
    });
    let was_catching = IS_CATCHING.replace(true);
    let result = catch_unwind(AssertUnwindSafe(work));
    IS_CATCHING.set(was_catching);
    result.map_err(|_| LAST_PANIC.take())
}

pub(crate) fn test_catching(subject: &mut impl Subject, case: &Case) -> Result<(), String> {
    catching(|| subject.test(case)).flatten()
}

#[derive(Default, Debug)]
pub(crate) struct Totals {
    pub(crate) runs: AtomicU64,
    pub(crate) returns: AtomicU64,
    pub(crate) exits: AtomicU64,
    pub(crate) traps: AtomicU64,
    pub(crate) incomplete: AtomicU64,
    pub(crate) steps: AtomicU64,
    pub(crate) instructions: AtomicU64,
    pub(crate) covered: AtomicU64,
}

impl Totals {
    fn add(&self, case: &Case) {
        let add = |total: &AtomicU64, more| total.fetch_add(more, Ordering::Relaxed);
        add(&self.covered, case.coverage.0 as u64);
        add(&self.instructions, case.coverage.1 as u64);
        for run in &case.references {
            add(&self.runs, 1);
            add(&self.steps, run.steps);
            let kind = match run.outcome {
                Outcome::Return(_) => &self.returns,
                Outcome::Exit(..) => &self.exits,
                Outcome::Trap(_) => &self.traps,
                _ => &self.incomplete,
            };
            add(kind, 1);
        }
    }
}

fn report(subject: &mut impl Subject, case: Case, problem: &str) -> String {
    let seed = case.seed;
    if test_catching(subject, &case).is_ok() {
        return format!("seed {seed}, only after the seeds before it\n{problem}");
    }
    let mut case = subject.narrow(case);
    if setting("UNREDUCED").is_none() {
        case = reduce(case, &mut |candidate| {
            test_catching(subject, candidate).is_err()
        });
    }
    let problem = test_catching(subject, &case).expect_err("the failure can be repeated");
    let quiets = case.program.function.quiets_nans;
    format!(
        "seed {seed}, {:?}, quiets NaNs: {quiets}\n{problem}\n{}",
        case.world.target,
        subject.describe(&case)
    )
}

/// Panics if the subject fails a test.
pub(crate) fn campaign<S: Subject>(
    default_count: u64,
    new_subject: impl Fn() -> S + Sync,
) -> Totals {
    const STACK_SIZE: usize = 16 << 20;
    let first = number_setting("SEED", 0);
    let end = first + number_setting("COUNT", default_count);
    let keeps_going = setting("KEEP_GOING").is_some();
    let (next, has_failed, totals) = (
        AtomicU64::new(first),
        AtomicBool::new(false),
        Totals::default(),
    );
    let work = || {
        let mut subject = new_subject();
        while keeps_going || !has_failed.load(Ordering::Relaxed) {
            let seed = next.fetch_add(1, Ordering::Relaxed);
            if seed >= end {
                break;
            }
            let case = Case::generate(seed, &subject.shape(seed), &subject.world(seed));
            totals.add(&case);
            let Err(problem) = test_catching(&mut subject, &case) else {
                continue;
            };
            let is_first = !has_failed.swap(true, Ordering::Relaxed);
            if keeps_going {
                eprintln!(
                    "seed {seed}: {}",
                    problem.lines().next().unwrap_or_default()
                );
            } else if is_first {
                eprintln!("{}", report(&mut subject, case, &problem));
            }
        }
    };
    std::thread::scope(|scope| {
        for _ in 0..number_setting("THREADS", 4) {
            std::thread::Builder::new()
                .stack_size(STACK_SIZE)
                .spawn_scoped(scope, work)
                .unwrap();
        }
    });
    assert!(!has_failed.into_inner(), "see above");
    totals
}

// Passes

/// Other passes may expect that these have run.
const PREREQUISITES: [&str; 1] = ["construct_ssa"];

pub(crate) fn all_passes() -> Vec<&'static Pass> {
    let left_out = setting("WITHOUT").unwrap_or_default();
    let is_left_out = |pass: &Pass| left_out.split(',').any(|name| name == pass.name);
    Pass::ALL.iter().filter(|pass| !is_left_out(pass)).collect()
}

fn has_natural_loops(function: &Function) -> bool {
    let cfg = Cfg::new(function);
    cfg.loops().values().all(|data| data.is_natural)
}

pub(crate) fn pass_named(name: &str) -> &'static Pass {
    let found = all_passes().into_iter().find(|pass| pass.name == name);
    found.unwrap_or_else(|| panic!("no pass is named {name}"))
}

#[derive(Clone, Copy)]
pub(crate) enum Order {
    Pipeline(Level),
    /// Each pass on the program as it was generated.
    Single,
    Random,
}

pub(crate) struct Passes {
    order: Order,
    /// Replaces the order.
    fixed: Option<Vec<&'static Pass>>,
    /// Goes from one function to the next, as in a compiler.
    analyses: Analyses,
}

impl Passes {
    pub(crate) fn new(order: Order) -> Self {
        let fixed = setting("PASSES").map(|names| names.split(',').map(pass_named).collect());
        Self {
            order,
            fixed,
            analyses: Analyses::default(),
        }
    }

    fn schedules(&self, seed: u64) -> Vec<Vec<&'static Pass>> {
        if let Some(fixed) = &self.fixed {
            return vec![fixed.clone()];
        }
        let (first, rest): (Vec<_>, Vec<_>) = all_passes()
            .into_iter()
            .partition(|pass| PREREQUISITES.contains(&pass.name));
        match self.order {
            Order::Pipeline(level) => vec![Pass::pipeline(level).iter().collect()],
            Order::Single => rest
                .iter()
                .map(|&pass| [&first[..], &[pass]].concat())
                .collect(),
            Order::Random if rest.is_empty() => Vec::new(),
            Order::Random => {
                let mut random = Random::new(mix(seed, 4));
                let chosen: Vec<_> = (0..random.between(2, 8))
                    .map(|_| random.pick(&rest))
                    .collect();
                vec![[first, chosen].concat()]
            }
        }
    }

    /// What no input shows.
    fn check_structure(function: &Function, had_natural_loops: bool) -> Result<(), String> {
        if had_natural_loops && !has_natural_loops(function) {
            return Err("a loop has got another entry".into());
        }
        let cfg = Cfg::new(function);
        let instructions = cfg.order().iter();
        let instructions = instructions.flat_map(|&block| function.instructions(block));
        let mut tokens: Vec<u32> = instructions
            .filter_map(|value| match *function.op(value) {
                Op::Patchpoint(patchpoint) => Some(function.patchpoint(patchpoint)),
                _ => None,
            })
            .filter(|data| data.flags.contains(PatchpointFlags::UNIQUE))
            .map(|data| data.token.0)
            .collect();
        tokens.sort_unstable();
        match tokens.chunk_by(|a, b| a == b).find(|same| same.len() > 1) {
            Some(same) => Err(format!("#{} has been copied", same[0])),
            None => Ok(()),
        }
    }

    /// The pass that fails, the function it was given, and what is wrong.
    fn find_failure(&mut self, case: &Case) -> Option<(&'static Pass, Function, String)> {
        let target = case.world.target;
        for schedule in self.schedules(case.seed) {
            let mut function = case.program.function.clone();
            self.analyses.invalidate();
            for (position, &pass) in schedule.iter().enumerate() {
                let had_natural_loops = has_natural_loops(&function);
                let result = catching(|| pass.run(&mut function, &mut self.analyses, target));
                let result = result.and_then(|()| {
                    Self::check_structure(&function, had_natural_loops)
                        .and_then(|()| case.check(&function))
                        .map_err(|problem| format!("{problem}\nafter:\n{function:?}"))
                });
                if let Err(problem) = result {
                    let mut before = case.program.function.clone();
                    self.analyses = Analyses::default();
                    for earlier in &schedule[..position] {
                        earlier.run(&mut before, &mut self.analyses, target);
                    }
                    return Some((pass, before, problem));
                }
            }
        }
        None
    }
}

impl Subject for Passes {
    fn world(&mut self, seed: u64) -> World {
        World::imaginary(seed)
    }

    fn test(&mut self, case: &Case) -> Result<(), String> {
        match self.find_failure(case) {
            None => Ok(()),
            Some((pass, before, problem)) => {
                Err(format!("{}: {problem}\nbefore:\n{before:?}", pass.name))
            }
        }
    }

    fn narrow(&mut self, case: Case) -> Case {
        let (pass, before, _) = self
            .find_failure(&case)
            .expect("the failure can be repeated");
        let all = self.fixed.replace(vec![pass]);
        match case.with_function(before) {
            Ok(narrow) if self.find_failure(&narrow).is_some() => narrow,
            _ => {
                self.fixed = all;
                case
            }
        }
    }
}
