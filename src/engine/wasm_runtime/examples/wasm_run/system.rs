//! As much of the system interface as programs that only compute need.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::rc::Rc;
use std::time::{Instant, SystemTime};

use bun_engine_wasm_format::{Extern, MemoryIndex};
use bun_engine_wasm_runtime::{Bits, Memory, Module, TableType, Tag};

use crate::support::link::Item;
use crate::support::machine::{Failure, Machine};

const SUCCESS: u32 = 0;
const BAD_DESCRIPTOR: u32 = 8;
const NOT_IMPLEMENTED: u32 = 52;
const CANNOT_SEEK: u32 = 70;

type Call = dyn Fn(&Memory, &[u64]) -> Result<u32, Failure>;

fn read_u32(memory: &Memory, address: u64) -> Result<u32, Failure> {
    let mut bytes = [0; 4];
    memory.read(address, &mut bytes).map_err(Failure::Trap)?;
    Ok(u32::from_le_bytes(bytes))
}

fn write(memory: &Memory, address: u64, bytes: &[u8]) -> Result<u32, Failure> {
    memory.write(address, bytes).map_err(Failure::Trap)?;
    Ok(SUCCESS)
}

fn buffers(memory: &Memory, list: u64, count: u64) -> Result<Vec<(u64, usize)>, Failure> {
    let buffer = |index| {
        let entry = list + index * 8;
        Ok((
            read_u32(memory, entry)?.into(),
            read_u32(memory, entry + 4)? as usize,
        ))
    };
    (0..count).map(buffer).collect()
}

fn fd_write(memory: &Memory, arguments: &[u64]) -> Result<u32, Failure> {
    let mut all = Vec::new();
    for (address, length) in buffers(memory, arguments[1], arguments[2])? {
        let start = all.len();
        all.resize(start + length, 0);
        memory
            .read(address, &mut all[start..])
            .map_err(Failure::Trap)?;
    }
    match arguments[0] {
        1 => std::io::stdout().write_all(&all).unwrap(),
        2 => std::io::stderr().write_all(&all).unwrap(),
        _ => return Ok(BAD_DESCRIPTOR),
    }
    write(memory, arguments[3], &(all.len() as u32).to_le_bytes())
}

fn fd_read(memory: &Memory, arguments: &[u64]) -> Result<u32, Failure> {
    if arguments[0] != 0 {
        return Ok(BAD_DESCRIPTOR);
    }
    let mut total = 0;
    for (address, length) in buffers(memory, arguments[1], arguments[2])? {
        let mut bytes = vec![0; length];
        let count = std::io::stdin().read(&mut bytes).unwrap();
        write(memory, address, &bytes[..count])?;
        total += count as u32;
        if count < length {
            break;
        }
    }
    write(memory, arguments[3], &total.to_le_bytes())
}

fn fd_fdstat_get(memory: &Memory, arguments: &[u64]) -> Result<u32, Failure> {
    const CHARACTER_DEVICE: u8 = 2;
    let mut status = [0; 24];
    status[0] = CHARACTER_DEVICE;
    match arguments[0] {
        0..=2 => write(memory, arguments[1], &status),
        _ => Ok(BAD_DESCRIPTOR),
    }
}

fn sizes_of(strings: &[String]) -> Box<Call> {
    let size: usize = strings.iter().map(|it| it.len() + 1).sum();
    let count = strings.len();
    Box::new(move |memory, arguments| {
        write(memory, arguments[0], &(count as u32).to_le_bytes())?;
        write(memory, arguments[1], &(size as u32).to_le_bytes())
    })
}

fn contents_of(strings: Vec<String>) -> Box<Call> {
    Box::new(move |memory, arguments| {
        let mut next = arguments[1];
        for (string, index) in strings.iter().zip(0..) {
            write(
                memory,
                arguments[0] + index * 4,
                &(next as u32).to_le_bytes(),
            )?;
            write(memory, next, string.as_bytes())?;
            next += string.len() as u64 + 1;
            write(memory, next - 1, &[0])?;
        }
        Ok(SUCCESS)
    })
}

/// Something new of the declared type.
fn made_to_fit(machine: &Machine, module: &Module, item: Extern) -> Option<Item> {
    let types = module.types();
    Some(match item {
        Extern::Func(_) => return None,
        Extern::Memory(index) => Item::Memory(machine.new_memory(*module.memory(index))?),
        Extern::Table(index) => Item::Table(machine.new_table(TableType {
            element: types.canonical_value(module.table(index).element.into()),
            address: module.table(index).address,
            limits: module.table(index).limits,
        })),
        Extern::Global(index) => {
            let global = module.global(index);
            (!global.ty.is_ref()).then_some(())?;
            Item::Global(machine.new_global(global.ty, global.mutable, 0))
        }
        Extern::Tag(index) => Item::Tag(Tag::new(types.canonical(module.tags()[index.usize()]))),
    })
}

/// Functions that it does not know fail when they are called.
pub(crate) fn imports(
    machine: &Machine,
    importer: &Module,
    arguments: &[String],
) -> impl Fn(&[u8], &[u8]) -> Option<Item> {
    let start = Instant::now();
    let clock = move |memory: &Memory, arguments: &[u64]| {
        let time = match arguments[0] {
            0 => SystemTime::UNIX_EPOCH.elapsed().unwrap(),
            _ => start.elapsed(),
        };
        write(
            memory,
            arguments[2],
            &(time.as_nanos() as u64).to_le_bytes(),
        )
    };
    let random = |memory: &Memory, arguments: &[u64]| {
        let bytes: Vec<u8> = (0..arguments[1])
            .map(|index| (index * 167 + 13) as u8)
            .collect();
        write(memory, arguments[0], &bytes)
    };
    let calls: [(&str, Box<Call>); 15] = [
        ("fd_write", Box::new(fd_write)),
        ("fd_read", Box::new(fd_read)),
        ("fd_fdstat_get", Box::new(fd_fdstat_get)),
        ("fd_close", Box::new(|_, _| Ok(SUCCESS))),
        ("fd_seek", Box::new(|_, _| Ok(CANNOT_SEEK))),
        ("fd_prestat_get", Box::new(|_, _| Ok(BAD_DESCRIPTOR))),
        ("args_sizes_get", sizes_of(arguments)),
        ("args_get", contents_of(arguments.to_vec())),
        ("environ_sizes_get", sizes_of(&[])),
        ("environ_get", contents_of(Vec::new())),
        ("clock_time_get", Box::new(clock)),
        ("random_get", Box::new(random)),
        ("sched_yield", Box::new(|_, _| Ok(SUCCESS))),
        (
            "proc_exit",
            Box::new(|_, it| Err(Failure::Exit(it[0] as i32))),
        ),
        ("", Box::new(|_, _| Ok(NOT_IMPLEMENTED))),
    ];
    let item = |(name, call): (&'static str, Box<Call>)| {
        let function = machine.host_function(
            None,
            Rc::new(move |_, instance, arguments| {
                let arguments: Vec<_> = arguments.iter().map(|&it| it as u64).collect();
                let result = call(instance.memory(MemoryIndex(0)), &arguments)?;
                Ok(vec![Bits::from(result)])
            }),
        );
        (name.as_bytes(), function)
    };
    let known: HashMap<_, _> = calls.into_iter().map(item).collect();
    let now = machine.host_function(
        None,
        Rc::new(move |_, _, _| Ok(vec![(start.elapsed().as_secs_f64() * 1e3).to_bits().into()])),
    );
    let missing = machine.host_function(None, Rc::new(|_, _, _| Err(Failure::Exit(127))));
    let others: HashMap<_, _> = (importer.imports().iter())
        .filter_map(|import| {
            let name = (importer.bytes(import.module), importer.bytes(import.field));
            Some((name, made_to_fit(machine, importer, import.item)?))
        })
        .collect();
    move |module, field| {
        if let Some(item) = others.get(&(module, field)) {
            return Some(item.clone());
        }
        Some(match (module, field) {
            (b"wasi_snapshot_preview1" | b"wasi_unstable", _) => {
                known.get(field).unwrap_or_else(|| &known[&b""[..]]).clone()
            }
            (_, b"now" | b"emscripten_get_now") => now.clone(),
            _ => missing.clone(),
        })
    }
}
