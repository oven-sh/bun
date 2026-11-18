use std::cell::Cell;
use std::process::ExitCode;
use std::time::Instant;

use bun_engine_wasm_format::{Extern, MemoryIndex, ValKind, ValType};
use bun_engine_wasm_runtime::{Bits, CompileError, Instance, Reference, wait_for_background_work};

use crate::support::link::{InstantiateError, export};
use crate::support::machine::{Failure, Machine};
use crate::support::{engine, spawn};
use crate::{Settings, system};

fn with_instance(
    settings: &Settings,
    engine: &'static bun_engine_wasm_runtime::Engine,
    file: &str,
    arguments: &[String],
    body: impl FnOnce(&Machine, Result<&Instance, InstantiateError>) -> ExitCode + Send,
) -> ExitCode {
    let bytes = std::fs::read(file).unwrap();
    let run = |machine: &Machine| {
        if let Some(interval) = settings.collection_interval {
            machine.collect_every(interval);
        }
        if settings.recycles {
            machine.recycle_cells();
        }
        let last = Cell::new(Instant::now());
        let lap = |what: &str| {
            let elapsed = last.replace(Instant::now()).elapsed();
            if settings.time {
                eprintln!("{what}: {:.3} ms", elapsed.as_secs_f64() * 1e3);
            }
        };
        let mut loaded: Vec<(&str, &Instance)> = Vec::new();
        let instantiate = |bytes, loaded: &[(&str, &Instance)]| {
            let module = engine.compile(bytes)?;
            lap("validate");
            let system = system::imports(machine, &module, arguments);
            let instance = machine.instantiate(&module, &|module, field| {
                let mut named = loaded.iter().filter(|it| it.0.as_bytes() == module);
                let found = named.find_map(|it| export(it.1, field));
                found.or_else(|| system(module, field))
            });
            lap("instantiate");
            Ok::<_, CompileError>(instance)
        };
        for preload in &settings.preloads {
            let (name, file) = preload.split_once('=').unwrap();
            let instance = instantiate(std::fs::read(file).unwrap(), &loaded);
            loaded.push((name, instance.unwrap().unwrap()));
        }
        let instance = match instantiate(bytes, &loaded) {
            Ok(instance) => instance,
            Err(error) => {
                println!("{error:?}");
                return ExitCode::FAILURE;
            }
        };
        let outcome = body(machine, instance);
        lap("run");
        if settings.time {
            let code = bun_engine_exec_memory::usage().bytes_in_use;
            eprintln!("code: {} KiB", code >> 10);
        }
        outcome
    };
    std::thread::scope(|scope| {
        spawn(scope, engine, settings.stack_size, run)
            .join()
            .unwrap()
    })
}

fn report(machine: &Machine, failure: Failure) -> ExitCode {
    if let Failure::Exit(code) = failure {
        return ExitCode::from(code as u8);
    }
    eprintln!("{failure:?} in {:?}", machine.stack_trace.borrow());
    ExitCode::FAILURE
}

pub(crate) fn run(settings: &Settings, arguments: &[String]) -> Option<ExitCode> {
    let body = |machine: &Machine, instance: Result<&Instance, _>| {
        let outcome = machine.invoke(instance.unwrap(), "_start", &[]);
        outcome.map_or_else(|failure| report(machine, failure), |_| ExitCode::SUCCESS)
    };
    let engine = engine(settings.options);
    Some(with_instance(
        settings,
        engine,
        arguments.first()?,
        arguments,
        body,
    ))
}

fn parse_value(text: &str) -> Option<Bits> {
    Some(match text.split_once(':')? {
        ("i32", value) => (value.parse::<i64>().ok()? as u32).into(),
        ("i64", value) => (value.parse::<i128>().ok()? as u64).into(),
        ("f32", value) => value.parse::<f32>().ok()?.to_bits().into(),
        ("f64", value) => value.parse::<f64>().ok()?.to_bits().into(),
        _ => return None,
    })
}

pub(crate) fn call(settings: &Settings, arguments: &[String]) -> Option<ExitCode> {
    let [file, name, values @ ..] = arguments else {
        return None;
    };
    let values: Vec<_> = values
        .iter()
        .map(|it| parse_value(it))
        .collect::<Option<_>>()?;
    let body = |machine: &Machine, instance: Result<&Instance, _>| {
        let instance = instance.unwrap();
        for _ in 0..settings.repeat {
            let start = Instant::now();
            match machine.invoke(instance, name, &values) {
                Ok(results) => println!("{results:x?}"),
                Err(failure) => return report(machine, failure),
            }
            if settings.time {
                eprintln!("call: {:.3} ms", start.elapsed().as_secs_f64() * 1e3);
            }
        }
        ExitCode::SUCCESS
    };
    let engine = engine(settings.options);
    Some(with_instance(settings, engine, file, &arguments[..1], body))
}

/// The same in every run.
fn describe(ty: ValType, value: Bits) -> String {
    let reference = Reference(value as u64);
    match ty.kind() {
        ValKind::Ref if reference.is_null() => "null".into(),
        ValKind::Ref if reference.cell().is_some() => "ref".into(),
        _ => format!("{value:x}"),
    }
}

fn hash_of_memory(instance: &Instance, index: MemoryIndex) -> u64 {
    let memory = instance.memory(index);
    let mut bytes = vec![0; memory.len() as usize];
    memory.read(0, &mut bytes).unwrap();
    let step = |hash: u64, &byte: &u8| (hash ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, step)
}

fn call_exports(settings: &Settings, machine: &Machine, instance: &Instance) {
    let module = instance.module();
    for round in 0..settings.repeat {
        for export in module.exports() {
            let Extern::Func(func) = export.item else {
                continue;
            };
            let ty = module.func_type(func);
            if !ty.params.iter().all(|param| param.is_defaultable()) {
                continue;
            }
            let zero = |param: &ValType| match param.is_ref() {
                true => Reference::NULL.into(),
                false => 0,
            };
            let arguments: Vec<Bits> = ty.params.iter().map(zero).collect();
            let function = instance.function_reference(func).unwrap().cell().unwrap();
            let outcome = match machine.call(function, &arguments) {
                Ok(values) => {
                    let pairs = ty.results.iter().zip(values);
                    let texts: Vec<_> = pairs.map(|(&ty, value)| describe(ty, value)).collect();
                    texts.join(" ")
                }
                Err(Failure::Exception(_)) => "exception".into(),
                Err(failure) => format!("{failure:?}"),
            };
            println!("{round} func {func}: {outcome}");
        }
        wait_for_background_work();
    }
    for export in module.exports() {
        match export.item {
            Extern::Global(index) => {
                let value = instance.global(index).unwrap().get();
                println!(
                    "global {index}: {}",
                    describe(module.global(index).ty, value)
                );
            }
            Extern::Memory(index) => {
                println!("memory {index}: {:x}", hash_of_memory(instance, index));
            }
            Extern::Table(index) => println!("table {index}: {}", instance.table(index).len()),
            Extern::Func(_) | Extern::Tag(_) => {}
        }
    }
}

pub(crate) fn call_all(settings: &Settings, files: &[String]) -> ExitCode {
    let engine = engine(settings.options);
    for file in files {
        println!("{file}");
        let _ = with_instance(settings, engine, file, &[], |machine, instance| {
            match instance {
                Ok(instance) => call_exports(settings, machine, instance),
                Err(InstantiateError::Start(Failure::Exception(_))) => println!("start: exception"),
                Err(error) => println!("{error:?}"),
            }
            ExitCode::SUCCESS
        });
    }
    ExitCode::SUCCESS
}
