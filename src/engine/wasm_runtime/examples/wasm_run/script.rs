//! Each line of a script is a line number in the original, a command and its operands.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use bun_engine_asm::Width;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::{CanonicalValType, Limits, Memory, RefType, ValType};
use bun_engine_wasm_runtime::{
    Bits, Compiled, InitializeError, Instance, Module, Reference, SegmentError, TableType,
};

use crate::Settings;
use crate::support::heap::{Kind, kind_of};
use crate::support::link::{InstantiateError, Item, export};
use crate::support::machine::{Failure, Machine};
use crate::support::{engine, spawn};

thread_local! {
    static POSITION: RefCell<String> = const { RefCell::new(String::new()) };
}

pub(crate) fn report_position() {
    POSITION.with_borrow(|position| eprintln!("at {position}"));
}

fn unquote(text: &str) -> Vec<u8> {
    let mut bytes = text.as_bytes()[1..text.len() - 1].iter().copied();
    let mut result = Vec::new();
    while let Some(byte) = bytes.next() {
        result.push(match byte {
            b'\\' => {
                let digits = [bytes.next().unwrap(), bytes.next().unwrap()];
                u8::from_str_radix(std::str::from_utf8(&digits).unwrap(), 16).unwrap()
            }
            _ => byte,
        });
    }
    result
}

enum Outcome {
    Values(Vec<Bits>),
    Failed(Failure),
    NotInstantiated(InstantiateError),
}

struct Script<'a> {
    machine: &'a Machine,
    directory: &'a Path,
    spectest: HashMap<&'static str, Item>,
    registered: HashMap<Vec<u8>, &'a Instance>,
    instances: HashMap<String, &'a Instance>,
    modules: HashMap<String, Arc<Module>>,
}

fn spectest(machine: &Machine) -> HashMap<&'static str, Item> {
    const I32: ValType = ValType::I32;
    const I64: ValType = ValType::I64;
    const F32: ValType = ValType::F32;
    const F64: ValType = ValType::F64;
    let print = |params: &[ValType]| {
        machine.host_function(Some((params, &[])), Rc::new(|_, _, _| Ok(Vec::new())))
    };
    let global = |ty, value| Item::Global(machine.new_global(ty, false, value));
    let limits = |initial, maximum| Limits {
        initial,
        maximum: Some(maximum),
    };
    let table = |address| {
        Item::Table(machine.new_table(TableType {
            element: CanonicalValType::plain(ValType::FUNCREF),
            address,
            limits: limits(10, 20),
        }))
    };
    let memory = |shared| {
        let ty = Memory {
            address: Width::W32,
            pages: limits(1, 2),
            shared,
        };
        Item::Memory(machine.new_memory(ty).unwrap())
    };
    HashMap::from([
        ("print", print(&[])),
        ("print_i32", print(&[I32])),
        ("print_i64", print(&[I64])),
        ("print_f32", print(&[F32])),
        ("print_f64", print(&[F64])),
        ("print_i32_f32", print(&[I32, F32])),
        ("print_f64_f64", print(&[F64, F64])),
        ("global_i32", global(I32, 666)),
        ("global_i64", global(I64, 666)),
        ("global_f32", global(F32, 666.6f32.to_bits().into())),
        ("global_f64", global(F64, 666.6f64.to_bits().into())),
        ("table", table(Width::W32)),
        ("table64", table(Width::W64)),
        ("memory", memory(false)),
        ("shared_memory", memory(true)),
    ])
}

fn is_expected(trap: Trap, message: &[u8]) -> bool {
    use Trap::*;
    let traps: &[(&[u8], &[Trap])] = &[
        (b"uninitialized element", &[SignatureMismatch]),
        (
            b"out of bounds memory access",
            &[
                MemoryOutOfBounds,
                ArrayNewDataFailure,
                ArrayInitDataOutOfBounds,
            ],
        ),
        (
            b"out of bounds table access",
            &[
                TableOutOfBounds,
                ArrayNewElemFailure,
                ArrayInitElemOutOfBounds,
            ],
        ),
        (
            b"out of bounds array access",
            &[
                ArrayGetOutOfBounds,
                ArraySetOutOfBounds,
                ArrayFillOutOfBounds,
                ArrayCopyOutOfBounds,
                ArrayInitDataOutOfBounds,
                ArrayInitElemOutOfBounds,
            ],
        ),
        (b"unreachable", &[Unreachable]),
        (b"unaligned atomic", &[UnalignedAtomic, MemoryOutOfBounds]),
        (
            b"integer overflow",
            &[IntegerOverflow, TruncationOutOfRange],
        ),
        (b"invalid conversion to integer", &[TruncationOutOfRange]),
        (b"integer divide by zero", &[DivisionByZero]),
        (b"cast failure", &[CastFailure, NullReference]),
        (b"undefined element", &[IndirectCallOutOfBounds]),
        (b"indirect call type mismatch", &[SignatureMismatch]),
        (b"call stack exhausted", &[StackOverflow]),
        (
            b"null array reference",
            &[NullReference, NullArrayInitData, NullArrayInitElem],
        ),
        (b"null reference", &[NullAsNonNull]),
        (b"null structure reference", &[NullReference]),
        (b"null i31 reference", &[NullI31]),
        (b"null function reference", &[NullFunction]),
        (b"null exception reference", &[NullExnref]),
    ];
    let matches =
        |entry: &(&[u8], &[Trap])| message.starts_with(entry.0) && entry.1.contains(&trap);
    traps.iter().any(matches)
}

fn float_matches(pattern: &str, bits: u64, width: u32) -> bool {
    let quiet_nan = if width == 32 {
        0x7fc0_0000
    } else {
        0x7ff8 << 48
    };
    let magnitude = bits & !(1 << (width - 1));
    match pattern {
        "canonical" => magnitude == quiet_nan,
        "arithmetic" => magnitude & quiet_nan == quiet_nan,
        exact => bits == u64::from_str_radix(exact, 16).unwrap(),
    }
}

impl<'a> Script<'a> {
    fn compile(&self, file: &str) -> Compiled {
        let bytes = std::fs::read(self.directory.join(file)).unwrap();
        self.machine.engine().compile(bytes)
    }

    fn valid(&self, file: &str) -> Result<Arc<Module>, String> {
        self.compile(file).map_err(|error| format!("{error:?}"))
    }

    fn instantiate(&self, module: &Arc<Module>) -> Result<&'a Instance, InstantiateError> {
        self.machine.instantiate(module, &|module, field| {
            if let Some(instance) = self.registered.get(module) {
                return export(instance, field);
            }
            let field = std::str::from_utf8(field).ok()?;
            self.spectest
                .get(field)
                .filter(|_| module == b"spectest")
                .cloned()
        })
    }

    fn instance(&self, name: &str) -> Result<&'a Instance, String> {
        let instance = self.instances.get(name).copied();
        instance.ok_or_else(|| format!("there is no instance {name}"))
    }

    fn name_instance(&mut self, name: &str, instance: &'a Instance) {
        self.instances.insert("-".into(), instance);
        self.instances.insert(name.into(), instance);
    }

    fn argument(&self, text: &str) -> Bits {
        match text.split_once(':').unwrap() {
            ("ref.null", _) => Reference::NULL.into(),
            ("ref.extern" | "ref.host", number) => {
                self.machine.opaque(number.parse().unwrap()).into()
            }
            (_, bits) => Bits::from_str_radix(bits, 16).unwrap(),
        }
    }

    fn matches(&self, pattern: &str, value: Bits) -> bool {
        let reference = Reference(value as u64);
        let has_type = |ty: RefType| {
            let ty = ty.heap_type().non_null();
            // SAFETY: the script expects a reference.
            unsafe { self.machine.engine().has_type(reference, ty, None) }
        };
        let lanes_match = |patterns: &str, width: u32| {
            let lane = |index: u32| (value >> (index * width)) as u64 & u64::MAX >> (64 - width);
            let mut lanes = patterns.split(',').zip(0..);
            lanes.all(|(pattern, index)| float_matches(pattern, lane(index), width))
        };
        match pattern.split_once(':').unwrap_or((pattern, "")) {
            ("either", cases) => cases.split('|').any(|case| self.matches(case, value)),
            ("f32", pattern) => float_matches(pattern, value as u64, 32),
            ("f64", pattern) => float_matches(pattern, value as u64, 64),
            ("f32x4", patterns) => lanes_match(patterns, 32),
            ("f64x2", patterns) => lanes_match(patterns, 64),
            ("ref.null", _) => reference.is_null(),
            ("ref.extern", "") => !reference.is_null(),
            ("ref.func", _) => reference.cell().map(kind_of) == Some(Kind::Function),
            ("ref.any", _) => has_type(RefType::ANYREF),
            ("ref.eq", _) => has_type(RefType::EQREF),
            ("ref.array", _) => has_type(RefType::ARRAYREF),
            ("ref.struct", _) => has_type(RefType::STRUCTREF),
            ("ref.i31", _) => has_type(RefType::I31REF),
            _ => value == self.argument(pattern),
        }
    }

    fn act(&self, words: &[&str]) -> Result<Outcome, String> {
        let item =
            |instance, name| Ok::<_, String>(export(self.instance(instance)?, &unquote(name)));
        match *words {
            ["invoke", instance, name, ref arguments @ ..] => {
                let arguments: Vec<_> = arguments.iter().map(|it| self.argument(it)).collect();
                let Some(Item::Function(function)) = item(instance, name)? else {
                    return Err("there is no such function".into());
                };
                let outcome = self.machine.call(function, &arguments);
                Ok(outcome.map_or_else(Outcome::Failed, Outcome::Values))
            }
            ["get", instance, name] => match item(instance, name)? {
                Some(Item::Global(global)) => Ok(Outcome::Values(vec![global.get()])),
                _ => Err("there is no such global".into()),
            },
            ["instantiate", file] => Ok(match self.instantiate(&self.valid(file)?) {
                Ok(_) => Outcome::Values(Vec::new()),
                Err(InstantiateError::Start(failure)) => Outcome::Failed(failure),
                Err(error) => Outcome::NotInstantiated(error),
            }),
            _ => Err("unknown action".into()),
        }
    }

    fn assert(&self, command: &str, words: &[&str]) -> Result<(), String> {
        let arrow = words.iter().position(|&word| word == "=>");
        let (action, expected) = words.split_at(arrow.unwrap_or(words.len()));
        let expected = expected.get(1..).unwrap_or_default();
        let trap = |trap| is_expected(trap, &unquote(expected[0]));
        let outcome = self.act(action)?;
        let holds = match (command, &outcome) {
            ("action", Outcome::Values(_)) => true,
            ("assert_return", Outcome::Values(values)) => {
                let mut pairs = expected.iter().zip(values);
                values.len() == expected.len() && pairs.all(|(it, &value)| self.matches(it, value))
            }
            ("assert_trap" | "assert_exhaustion", Outcome::Failed(Failure::Trap(it))) => trap(*it),
            ("assert_trap", Outcome::NotInstantiated(InstantiateError::Segment(error))) => {
                trap(match error {
                    SegmentError::ElementsOutOfBounds => Trap::TableOutOfBounds,
                    SegmentError::DataOutOfBounds { .. } => Trap::MemoryOutOfBounds,
                    SegmentError::OutOfMemory => Trap::OutOfMemory,
                })
            }
            (
                "assert_trap",
                Outcome::NotInstantiated(InstantiateError::Initialize(InitializeError::Constant(
                    it,
                ))),
            ) => trap(it.trap),
            ("assert_exception", Outcome::Failed(Failure::Exception(_))) => true,
            _ => false,
        };
        holds.then_some(()).ok_or_else(|| match outcome {
            Outcome::Values(values) => format!("got {values:x?}"),
            Outcome::Failed(failure) => format!("got {failure:?}"),
            Outcome::NotInstantiated(error) => format!("got {error:?}"),
        })
    }

    fn run(&mut self, words: &[&str]) -> Result<(), String> {
        match *words {
            ["module", file, name] => {
                self.instances.remove("-");
                let instance = self.instantiate(&self.valid(file)?);
                self.name_instance(name, instance.map_err(|error| format!("{error:?}"))?);
            }
            ["define", file, name] => {
                let module = self.valid(file)?;
                self.modules.insert("-".into(), Arc::clone(&module));
                self.modules.insert(name.into(), module);
            }
            ["instance", name, module] => {
                let instance = self.instantiate(&self.modules[module]);
                self.name_instance(name, instance.map_err(|error| format!("{error:?}"))?);
            }
            ["register", name, instance] => {
                self.registered
                    .insert(unquote(name), self.instance(instance)?);
            }
            ["assert_malformed" | "assert_invalid", file, message] => {
                let is_out_of_date = matches!(
                    &*unquote(message),
                    b"multiple tables" | b"multiple memories"
                );
                if self.compile(file).is_ok() && !is_out_of_date {
                    return Err("it is valid".into());
                }
            }
            ["assert_unlinkable", file, message] => {
                let is_unknown = unquote(message) == b"unknown import";
                match self.instantiate(&self.valid(file)?) {
                    Err(InstantiateError::UnknownImport) if is_unknown => {}
                    Err(InstantiateError::WrongKind | InstantiateError::Link(_)) if !is_unknown => {
                    }
                    other => return Err(format!("got {:?}", other.err())),
                }
            }
            [command, ref rest @ ..] => self.assert(command, rest)?,
            [] => {}
        }
        Ok(())
    }
}

/// Gives the numbers of commands and of failures.
fn run_script(settings: &Settings, machine: &Machine, directory: &Path) -> (usize, usize) {
    if let Some(interval) = settings.collection_interval {
        machine.collect_every(interval);
    }
    let text = std::fs::read_to_string(directory.join("commands.txt")).unwrap();
    let mut script = Script {
        machine,
        directory,
        spectest: spectest(machine),
        registered: HashMap::new(),
        instances: HashMap::new(),
        modules: HashMap::new(),
    };
    let mut failures = 0;
    for line in text.lines() {
        let position = format!("{}: {line}", directory.display());
        if settings.verbose {
            eprintln!("{position}");
        }
        POSITION.set(position);
        let words: Vec<_> = line.split(' ').skip(1).collect();
        let is_repeatable = words[0].starts_with("assert_") && words[1] == "invoke";
        if let Err(reason) = script.run(&words) {
            failures += 1;
            println!("{}: {line}: {reason}", directory.display());
        } else if is_repeatable && words[0] != "assert_return" {
            for _ in 1..settings.repeat {
                script.run(&words).unwrap();
            }
        }
    }
    (text.lines().count(), failures)
}

pub(crate) fn run_all(settings: &Settings, paths: &[String]) -> ExitCode {
    let mut directories = Vec::new();
    for path in paths.iter().map(PathBuf::from) {
        if path.join("commands.txt").exists() {
            directories.push(path);
        } else {
            let entries = std::fs::read_dir(path)
                .unwrap()
                .map(|it| it.unwrap().path());
            directories.extend(entries.filter(|it| it.join("commands.txt").exists()));
        }
    }
    directories.sort();
    let engine = engine(settings.options);
    let [next, commands, failures] = [(); 3].map(|()| AtomicUsize::new(0));
    let work = || {
        while let Some(directory) = directories.get(next.fetch_add(1, Ordering::Relaxed)) {
            let run = |machine: &Machine| run_script(settings, machine, directory);
            let counts = std::thread::scope(|scope| {
                spawn(scope, engine, settings.stack_size, run)
                    .join()
                    .unwrap()
            });
            commands.fetch_add(counts.0, Ordering::Relaxed);
            failures.fetch_add(counts.1, Ordering::Relaxed);
        }
    };
    std::thread::scope(|scope| {
        for _ in 0..settings.jobs {
            scope.spawn(work);
        }
    });
    let (commands, failures) = (commands.into_inner(), failures.into_inner());
    println!(
        "{} scripts, {commands} commands, {failures} failures",
        directories.len()
    );
    ExitCode::from(u8::from(failures != 0))
}
