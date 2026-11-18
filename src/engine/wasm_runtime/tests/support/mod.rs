#![allow(
    dead_code,
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

pub(crate) mod heap;
pub(crate) mod link;
pub(crate) mod machine;
pub(crate) mod text;
pub(crate) mod waiters;

use std::sync::Arc;

use bun_engine_wasm_compiler::optimize::Feedback;
use bun_engine_wasm_compiler::{CompiledFunction, Environment};
use bun_engine_wasm_format::{CodeIndex, Features};
use bun_engine_wasm_runtime::{
    Compilers, Engine, Instance, Module, Options, STACK_RESERVE, Tiering,
};

use self::link::Item;
use self::machine::{Machine, Native};

/// Stands in for the optimizing compiler.
pub(crate) fn baseline_without_counters(
    compilers: &mut Compilers,
    env: &Environment<'_>,
    code: CodeIndex,
    loop_entry: Option<u32>,
    _: &dyn Feedback,
) -> Option<CompiledFunction> {
    compilers.baseline.compile(env, code, None, loop_entry).ok()
}

pub(crate) fn options() -> Options {
    Options {
        features: Features::all(),
        cpu: bun_engine_asm::Features::host(),
        handle_faults: true,
        guard_memories: true,
        tiering: Tiering::BaselineOnly,
        optimizer: baseline_without_counters,
        use_threads: true,
        seed: 1,
    }
}

pub(crate) fn engine(options: Options) -> &'static Engine {
    Engine::new(&Native, options).unwrap()
}

/// Runs `body` on a new thread that has a machine.
pub(crate) fn spawn<'scope, T: Send + 'scope>(
    scope: &'scope std::thread::Scope<'scope, '_>,
    engine: &'static Engine,
    stack_size: usize,
    body: impl FnOnce(&Machine) -> T + Send + 'scope,
) -> std::thread::ScopedJoinHandle<'scope, T> {
    #[inline(never)]
    fn below<T>(machine: &Machine, body: impl FnOnce(&Machine) -> T) -> T {
        std::ptr::from_ref(machine).expose_provenance();
        body(machine)
    }
    const FOR_THE_THREAD: usize = 256 << 10;
    let thread =
        std::thread::Builder::new().stack_size(stack_size + STACK_RESERVE + FOR_THE_THREAD);
    let run = move || {
        let origin = 0usize;
        let origin = std::hint::black_box(&raw const origin).addr();
        below(&Machine::new(engine, origin, stack_size), body)
    };
    thread.spawn_scoped(scope, run).unwrap()
}

pub(crate) fn with_machine<T: Send>(
    engine: &'static Engine,
    body: impl FnOnce(&Machine) -> T + Send,
) -> T {
    let outcome = std::thread::scope(|scope| spawn(scope, engine, 1 << 20, body).join());
    outcome.unwrap_or_else(|panic| std::panic::resume_unwind(panic))
}

pub(crate) fn compile(engine: &'static Engine, source: &str) -> Arc<Module> {
    engine.compile(text::assemble(source)).unwrap()
}

impl Machine {
    /// Imports are found by the name of the field.
    pub(crate) fn load(&self, source: &str, imports: &[(&str, &Item)]) -> &Instance {
        let module = compile(self.engine(), source);
        self.instantiate(&module, &by_field(imports)).unwrap()
    }
}

pub(crate) fn by_field(imports: &[(&str, &Item)]) -> impl Fn(&[u8], &[u8]) -> Option<Item> {
    |_, field| {
        Some(
            imports
                .iter()
                .find(|it| it.0.as_bytes() == field)?
                .1
                .clone(),
        )
    }
}

/// The ways to access memory.
pub(crate) fn for_each_mode(test: impl Fn(&Machine) + Sync) {
    for (handle_faults, guard_memories) in [(true, true), (true, false), (false, false)] {
        let options = Options {
            handle_faults,
            guard_memories,
            ..options()
        };
        with_machine(engine(options), &test);
    }
}
