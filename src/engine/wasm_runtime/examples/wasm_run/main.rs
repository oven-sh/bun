//! Runs scripts of the specification's test suite, and programs.

#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros,
    clippy::missing_const_for_thread_local
)]

mod optimizers;
mod program;
mod script;
#[path = "../../tests/support/mod.rs"]
mod support;
mod system;

use std::io::Write;
use std::process::ExitCode;
use std::sync::{LazyLock, Mutex};

use bun_engine_asm::Features as CpuFeatures;
use bun_engine_wasm_format::Features;
use bun_engine_wasm_runtime::{Options, Tiering};

const USAGE: &str = "usage:
  wasm_run [option...] script <directory>...    each has a commands.txt, or directories that do
  wasm_run [option...] run <file> [argument...]            calls _start
  wasm_run [option...] call <file> <export> [value...]     values like i32:7 i64:-1 f64:1.5
  wasm_run [option...] all <file>...            calls all exports with zeros and prints what comes of it
options:
  --memory guarded|checked    --no-faults    --no-threads    --no-simd    --no-memory64
  --tier baseline|optimized|<threshold>      --optimizer full|quick|baseline    --fake-feedback
  --cpu <hexadecimal mask of features>       --gc <allocations between collections>
  --recycle (overwrites old objects)         --preload <name>=<file> (to import from)
  --stack <KiB>    --seed <n>    --repeat <n>    --jobs <n>    --perf-map    --dump <directory>    --time    --verbose";

pub(crate) struct Settings {
    pub(crate) options: Options,
    pub(crate) collection_interval: Option<u32>,
    pub(crate) recycles: bool,
    pub(crate) preloads: Vec<String>,
    pub(crate) stack_size: usize,
    pub(crate) repeat: u32,
    pub(crate) jobs: usize,
    pub(crate) time: bool,
    pub(crate) verbose: bool,
}

fn write_perf_map(start: usize, len: usize, name: &str) {
    static FILE: LazyLock<Mutex<std::fs::File>> = LazyLock::new(|| {
        let path = format!("/tmp/perf-{}.map", std::process::id());
        Mutex::new(std::fs::File::create(path).unwrap())
    });
    writeln!(FILE.lock().unwrap(), "{start:x} {len:x} {name}").unwrap();
}

static DUMP_DIRECTORY: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn dump(start: usize, len: usize, name: &str) {
    let name: String = name
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(80)
        .collect();
    let path = format!("{}/{start:x}-{name}.bin", DUMP_DIRECTORY.get().unwrap());
    // SAFETY: the code was just linked.
    let code = unsafe { std::slice::from_raw_parts(start as *const u8, len) };
    std::fs::write(path, code).unwrap();
}

fn parse(arguments: &mut std::vec::IntoIter<String>) -> Option<(Settings, String)> {
    let mut settings = Settings {
        options: Options {
            tiering: Tiering::DEFAULT,
            ..support::options()
        },
        collection_interval: None,
        recycles: false,
        preloads: Vec::new(),
        stack_size: 1 << 20,
        repeat: 1,
        jobs: 1,
        time: false,
        verbose: false,
    };
    let (mut optimizer, mut fakes_feedback) = ("full".to_owned(), false);
    let options = &mut settings.options;
    let command = loop {
        let argument = arguments.next()?;
        match argument.as_str() {
            "--memory" => options.guard_memories = arguments.next()? == "guarded",
            "--no-faults" => options.handle_faults = false,
            "--no-threads" => options.use_threads = false,
            "--no-simd" => options.features.remove(Features::SIMD),
            "--no-memory64" => options.features.remove(Features::MEMORY64),
            "--tier" => {
                options.tiering = match arguments.next()?.as_str() {
                    "baseline" => Tiering::BaselineOnly,
                    "optimized" => Tiering::OptimizedOnly,
                    threshold => Tiering::After(threshold.parse().ok()?),
                }
            }
            "--optimizer" => optimizer = arguments.next()?,
            "--fake-feedback" => fakes_feedback = true,
            "--cpu" => {
                let mask = u16::from_str_radix(&arguments.next()?, 16).ok()?;
                options.cpu &= CpuFeatures::from_bits_truncate(mask);
            }
            "--gc" => settings.collection_interval = Some(arguments.next()?.parse().ok()?),
            "--recycle" => settings.recycles = true,
            "--preload" => settings.preloads.push(arguments.next()?),
            "--stack" => settings.stack_size = arguments.next()?.parse::<usize>().ok()? << 10,
            "--seed" => options.seed = arguments.next()?.parse().ok()?,
            "--repeat" => settings.repeat = arguments.next()?.parse().ok()?,
            "--jobs" => settings.jobs = arguments.next()?.parse().ok()?,
            "--perf-map" => bun_engine_exec_memory::set_observer(write_perf_map),
            "--dump" => {
                DUMP_DIRECTORY.set(arguments.next()?).ok()?;
                bun_engine_exec_memory::set_observer(dump);
            }
            "--time" => settings.time = true,
            "--verbose" => settings.verbose = true,
            _ => break argument,
        }
    };
    options.optimizer = optimizers::named(&optimizer, fakes_feedback)?;
    Some((settings, command))
}

fn main() -> ExitCode {
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic| {
        report(panic);
        script::report_position();
        std::process::abort();
    }));
    let mut arguments = std::env::args().skip(1).collect::<Vec<_>>().into_iter();
    let outcome = parse(&mut arguments).and_then(|(settings, command)| {
        let rest = arguments.as_slice();
        let outcome = match command.as_str() {
            "script" => Some(script::run_all(&settings, rest)),
            "run" => program::run(&settings, rest),
            "call" => program::call(&settings, rest),
            "all" => Some(program::call_all(&settings, rest)),
            _ => None,
        };
        if settings.time {
            optimizers::report();
        }
        outcome
    });
    outcome.unwrap_or_else(|| {
        eprintln!("{USAGE}");
        ExitCode::from(2)
    })
}
