//! Compiles programs and runs them. More settings after `CODEGEN_FUZZ_`:
//!
//! - `FEATURES`: the bits of the features of the processor, which are otherwise some of those it has,
//! - `LEVEL`: `quick` or `full`, otherwise both.
//!
//! What `PASSES` names, or what `WITHOUT` leaves of the full pipeline, runs before a quick compilation.

#[cfg(target_os = "linux")]
mod execution;
#[cfg(target_os = "linux")]
#[cfg_attr(target_arch = "x86_64", path = "x86_64.rs")]
#[cfg_attr(target_arch = "aarch64", path = "arm64.rs")]
mod host;
#[cfg(target_os = "linux")]
mod processor;
mod recorder;

use std::collections::HashMap;

use bun_engine_asm::{
    Arm64Features, Code, FloatAssembly, Label, Options as AssemblerOptions, VectorAssembly,
    X64Features, arm64, x64,
};
use bun_engine_codegen::ir::{Function, Origin};
use bun_engine_codegen::passes::{Analyses, Level, Pass};
use bun_engine_codegen::{Arm64Compiler, Frame, Options, Target, TooComplex, X64Compiler};

use self::recorder::{Recorder, Stop};
use super::disassembly::listing;
use super::generator::Shape;
use super::harness::{Case, Subject, World, catching, pass_named, setting, shape_for};
use super::memory::{GRANULE, Layout};
use super::random::{Random, mix};

/// The callees come first.
mod stub {
    use crate::support::memory::GRANULE;
    use crate::support::vocabulary::CALLEE_COUNT;

    pub(super) const SITE: usize = CALLEE_COUNT;
    pub(super) const RETURN: usize = SITE + 1;
    pub(super) const SIGNAL: usize = SITE + 2;
    pub(super) const ENTER: usize = SITE + 3;
    pub(super) const SIZE: usize = 32;

    pub(super) fn address(base: u64, stub: usize) -> u64 {
        base + 4 * GRANULE + (stub * SIZE) as u64
    }
}

const ARENA_SIZE: u64 = 5 * GRANULE;
const ARENA_COUNT: usize = 192;

/// Depends on the seed alone, so that a failure can be repeated.
fn preferred_base(arena: usize) -> u64 {
    const AREAS: [u64; 3] = [0x1000_0000, 0xa000_0000, 0x3c5a_1234_0000];
    AREAS[arena % AREAS.len()] + (arena / AREAS.len()) as u64 * ARENA_SIZE
}

fn arena_for(seed: u64) -> usize {
    (mix(seed, 20) % ARENA_COUNT as u64) as usize
}

struct Compiled {
    function: Function,
    frame: Frame,
    code: Code,
    entries: Vec<Label>,
    origins: Vec<(u32, Origin)>,
    /// By the offset of the return address.
    stops: HashMap<u64, Stop>,
}

fn compile<M: FloatAssembly>(
    case: &Case,
    first_passes: &[&Pass],
    features: M::Features,
    compile: impl FnOnce(
        &mut Function,
        &mut M,
        &mut Recorder,
    ) -> Result<bun_engine_codegen::Compiled, TooComplex>,
) -> Compiled {
    const GAPS: [u32; 12] = [
        8, 104, 200, 248, 504, 1000, 4000, 0x4000, 0x8000, 70_000, 0x10_0000, 0x110_0008,
    ];
    let mut random = Random::new(mix(case.seed, 21));
    let (mut function, mut analyses) = (case.program.function.clone(), Analyses::default());
    for pass in first_passes {
        pass.run(&mut function, &mut analyses, case.world.target);
    }
    for bytes in [
        &mut function.reserved_frame_bytes,
        &mut function.outgoing_bytes,
    ] {
        if random.one_in(4) {
            *bytes += random.pick(&GAPS);
        }
    }
    let mut masm = M::new(AssemblerOptions {
        features,
        shorten_jumps: random.flip(),
        seed: 0,
    });
    let harness = stub::address(case.world.layout.base, stub::SITE);
    let mut recorder = Recorder::new(&case.program.function, harness as usize, random.next());
    let compiled = compile(&mut function, &mut masm, &mut recorder).unwrap();
    let code = masm.finish().unwrap();
    let origins = compiled.emitted.origins.iter();
    let stops = recorder.stops.into_iter();
    Compiled {
        function,
        frame: compiled.frame,
        entries: compiled.emitted.entries,
        origins: origins
            .map(|&(label, origin)| (code.offset_of(label), origin))
            .collect(),
        stops: stops
            .map(|(label, stop)| (code.offset_of(label).into(), stop))
            .collect(),
        code,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Architecture {
    X64,
    Arm64,
}

impl Architecture {
    pub(crate) const HOST: Self = if cfg!(target_arch = "x86_64") {
        Self::X64
    } else {
        Self::Arm64
    };

    fn can_run(self) -> bool {
        cfg!(target_os = "linux") && self == Self::HOST
    }

    fn target(self, seed: u64) -> Target {
        let mut random = Random::new(mix(seed, 22));
        let chosen = match random.below(4) {
            0 => 0,
            1 => u16::MAX,
            _ => random.next() as u16,
        };
        let mut bits = setting("FEATURES").map_or(chosen, |bits| bits.parse().expect("a number"));
        if self.can_run() {
            bits &= bun_engine_asm::Features::host().bits();
        }
        match self {
            Self::X64 => {
                let mut features = X64Features::from_bits_truncate(bits);
                if !features.contains(X64Features::AVX) {
                    features -= X64Features::AVX2 | X64Features::FMA | X64Features::F16C;
                }
                Target::X64(features)
            }
            Self::Arm64 => Target::Arm64(Arm64Features::from_bits_truncate(bits)),
        }
    }
}

/// Only compiles what this processor cannot run.
pub(crate) struct Native {
    architecture: Architecture,
    levels: Vec<Level>,
    first_passes: Vec<&'static Pass>,
    /// The last pass that it takes to bring a failure about.
    needed_pass: Option<&'static str>,
    x64: X64Compiler,
    arm64: Arm64Compiler,
    #[cfg(target_os = "linux")]
    thread: processor::Thread,
}

impl Native {
    pub(crate) fn new(architecture: Architecture) -> Self {
        let named = setting("PASSES").map(|names| names.split(',').map(pass_named).collect());
        let chosen: Option<Vec<_>> = named.or_else(|| {
            let left_out = setting("WITHOUT")?;
            let is_kept = |pass: &&Pass| left_out.split(',').all(|name| name != pass.name);
            Some(Pass::pipeline(Level::Full).iter().filter(is_kept).collect())
        });
        Self {
            architecture,
            levels: match setting("LEVEL").as_deref() {
                Some("full") => vec![Level::Full],
                None if chosen.is_none() => vec![Level::Quick, Level::Full],
                _ => vec![Level::Quick],
            },
            first_passes: chosen.unwrap_or_default(),
            needed_pass: None,
            x64: X64Compiler::default(),
            arm64: Arm64Compiler::default(),
            #[cfg(target_os = "linux")]
            thread: processor::Thread::new(),
        }
    }

    fn compile(&mut self, case: &Case, level: Level) -> Compiled {
        let options = Options {
            level,
            records_origins: true,
        };
        let passes = &self.first_passes;
        // A panic leaves the tables of a compiler in any state, so it is lost with them.
        match case.world.target {
            Target::X64(features) => compile(case, passes, features, |function, masm, client| {
                let mut compiler = std::mem::take(&mut self.x64);
                let compiled = compiler.compile(function, options, masm, client);
                self.x64 = compiler;
                compiled
            }),
            Target::Arm64(features) => compile(case, passes, features, |function, masm, client| {
                let mut compiler = std::mem::take(&mut self.arm64);
                let compiled = compiler.compile(function, options, masm, client);
                self.arm64 = compiler;
                compiled
            }),
        }
    }

    #[cfg(target_os = "linux")]
    fn run(&mut self, case: &Case, compiled: &Compiled) -> Result<(), String> {
        use bun_engine_exec_memory::{Priority, link};
        execution::check_layout(compiled)?;
        let callees = &case.world.layout.callees;
        let symbol = |callee: u32| callees[callee as usize] as usize;
        let linked = link(&compiled.code, Priority::Required, symbol).unwrap();
        let sites = super::vocabulary::sites(&case.program.function);
        let mut processor = processor::Arena::get(arena_for(case.seed)).lock();
        let mut execution = execution::Execution::new(
            case,
            &sites,
            compiled,
            linked.start() as u64,
            &mut processor,
            self.thread.stack_end(),
        );
        for (index, input) in case.inputs.iter().enumerate() {
            if case.references[index].is_complete() {
                execution.check(index).map_err(|problem| {
                    let (entry, args) = (input.entry, &input.args);
                    format!("{problem} (entry {entry}, arguments {args:x?})")
                })?;
            }
        }
        Ok(())
    }

    #[cfg(not(target_os = "linux"))]
    fn run(&mut self, _: &Case, _: &Compiled) -> Result<(), String> {
        unreachable!("cannot run")
    }

    fn test_at(&mut self, case: &Case, level: Level) -> Result<(), String> {
        let compiled = catching(|| self.compile(case, level))?;
        if self.architecture.can_run() {
            self.run(case, &compiled).map_err(|problem| {
                let mut stages = stages(case, self.passes(level));
                match stages.find(|(_, function)| case.check(function).is_err()) {
                    Some((pass, _)) => format!("{pass} is to blame: {problem}"),
                    None => problem,
                }
            })?;
        }
        Ok(())
    }

    fn passes(&self, level: Level) -> Vec<&'static Pass> {
        let first = self.first_passes.iter().copied();
        first.chain(Pass::pipeline(level)).collect()
    }
}

/// The name of each pass, and the function after it.
fn stages(
    case: &Case,
    passes: Vec<&'static Pass>,
) -> impl Iterator<Item = (&'static str, Function)> {
    let (mut function, mut analyses) = (case.program.function.clone(), Analyses::default());
    passes.into_iter().map(move |pass| {
        pass.run(&mut function, &mut analyses, case.world.target);
        (pass.name, function.clone())
    })
}

impl Subject for Native {
    fn world(&mut self, seed: u64) -> World {
        let arena = arena_for(seed);
        #[cfg(target_os = "linux")]
        let base = processor::Arena::get(arena).base;
        #[cfg(not(target_os = "linux"))]
        let base = preferred_base(arena);
        let target = self.architecture.target(seed);
        World {
            layout: Layout {
                base,
                callees: std::array::from_fn(|callee| stub::address(base, callee)),
            },
            target,
            relaxed: match target {
                Target::X64(features) => x64::MacroAssembler::relaxed(features),
                Target::Arm64(features) => arm64::MacroAssembler::relaxed(features),
            },
            other_threads: false,
        }
    }

    fn shape(&mut self, seed: u64) -> Shape {
        let mut shape = shape_for(seed);
        shape.weights.nodes = 0;
        shape
    }

    fn test(&mut self, case: &Case) -> Result<(), String> {
        for level in self.levels.clone() {
            self.test_at(case, level)
                .map_err(|problem| format!("{level:?}: {problem}"))?;
        }
        Ok(())
    }

    /// Goes on with what the fewest passes make of the program, unless they are to blame.
    fn narrow(&mut self, case: Case) -> Case {
        let mut levels = self.levels.clone().into_iter();
        let level = levels.find(|&level| self.test_at(&case, level).is_err());
        let level = level.expect("the failure can be repeated");
        self.levels = vec![level];
        let Ok(stages) = catching(|| stages(&case, self.passes(level)).collect::<Vec<_>>()) else {
            return case;
        };
        let good = stages
            .into_iter()
            .take_while(|(_, function)| case.check(function).is_ok());
        let cases: Vec<_> = good
            .filter_map(|(pass, function)| Some((pass, case.with_function(function).ok()?)))
            .collect();
        let first_passes = std::mem::take(&mut self.first_passes);
        let quickly = cases.iter().map(|stage| (Level::Quick, stage));
        for (level, (pass, narrow)) in quickly.chain(cases.last().map(|last| (level, last))) {
            if self.test_at(narrow, level).is_err() {
                (self.levels, self.needed_pass) = (vec![level], Some(*pass));
                return narrow.clone();
            }
        }
        self.first_passes = first_passes;
        case
    }

    fn describe(&mut self, case: &Case) -> String {
        let level = self.levels[0];
        let start = self.needed_pass.unwrap_or("no pass");
        let program = format!(
            "reduced from the program after {start}:\n{:?}",
            case.program.function
        );
        let Ok(compiled) = catching(|| self.compile(case, level)) else {
            return program;
        };
        let (function, code) = (&compiled.function, &compiled.code);
        format!(
            "{program}\nafter the passes:\n{function:?}\ndata at {:#x}, frame of {} bytes, origins {:x?}\n{}",
            case.world.layout.data_start(),
            compiled.frame.size,
            compiled.origins,
            listing(case.world.target, code).unwrap_or_default(),
        )
    }
}
