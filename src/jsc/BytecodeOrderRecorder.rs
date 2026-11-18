//! `BUN_BYTECODE_ORDER_OUT=<path>` in a `--compile --bytecode` executable: record what every thread of the process (the main
//! thread and each Worker) reads out of the bytecode payload, and have the main thread write it at exit as a payload
//! order file (`bun_bundler::bytecode_order` reads it back
//! for `--bytecode-order`). `%p` in the path becomes the pid. Nothing is recorded without the variable.
//! Apart from that, in an executable built with an order file every thread counts the function bodies it decodes by the
//! region of the payload they are in (`bytecodeOrderStats()` of `bun:jsc`).

use core::cell::Cell;

use bun_bundler::bytecode::{digest_of_chunk, digest_of_internal_module, host_builtins};
use bun_bundler::bytecode_order::{self, REGION_COUNT, Recording};
use bun_collections::HashMap;
use bun_engine_bytecode::cache::{
    Digest, Embedding, EntryId, FunctionKey, Observer, Region, order_hash,
};
use bun_engine_text::{StringRef, Text};
use bun_exe_format::builtins::Builtins;
use bun_threading::Guarded;

use crate::generated_bindgen::bytecode_order_recorder::{
    BytecodeOrderNames, BytecodeOrderTextKind,
};

type Graph = &'static dyn bun_resolver::StandaloneModuleGraph;

/// What one thread has read, in that order.
#[derive(Default)]
struct Reads {
    functions: Vec<(EntryId, FunctionKey)>,
    entries: Vec<(EntryId, bool)>,
    strings: Vec<u64>,
    seen_strings: HashMap<u64, ()>,
}

/// In the order in which the threads began. `None` once they are taken, and if nothing is recorded.
static READS: Guarded<Option<Vec<Reads>>> = Guarded::new(None);

thread_local! {
    static INDEX_IN_READS: Cell<Option<usize>> = const { Cell::new(None) };
    /// How many functions were hot, unknown and cold, then how many bytes.
    static DECODED: [Cell<u64>; 6] = const { [const { Cell::new(0) }; 6] };
}

fn record(read: impl FnOnce(&mut Reads)) {
    if let Some(threads) = &mut *READS.lock() {
        let index = INDEX_IN_READS.get().unwrap_or_else(|| {
            threads.push(Reads::default());
            threads.len() - 1
        });
        INDEX_IN_READS.set(Some(index));
        read(&mut threads[index]);
    }
}

struct Watcher {
    region_ends: [u32; REGION_COUNT],
    is_recording: bool,
}

impl Observer for Watcher {
    fn entry_read(&self, entry: EntryId, is_usable: bool) {
        if self.is_recording {
            record(|reads| reads.entries.push((entry, is_usable)));
        }
    }

    fn function_read(&self, entry: EntryId, key: Option<FunctionKey>, at: core::ops::Range<u32>) {
        let is_after = |region: Region| usize::from(at.start >= self.region_ends[region as usize]);
        let class = is_after(Region::Hot) + is_after(Region::Unknown);
        DECODED.with(|decoded| {
            decoded[class].update(|count| count + 1);
            decoded[3 + class].update(|bytes| bytes + at.len() as u64);
        });
        if self.is_recording {
            record(|reads| reads.functions.extend(key.map(|key| (entry, key))));
        }
    }

    fn shared_string_read(&self, text: Text<'_>) {
        let hash = order_hash(text);
        record(|reads| {
            if reads.seen_strings.insert(hash, ()).is_none() {
                reads.strings.push(hash);
            }
        });
    }
}

/// Before the first VM is made.
pub(crate) fn install(graph: Graph) {
    let (linked, is_recording) = (graph.linked_bytecode_payload(), output_path().is_some());
    *READS.lock() = is_recording.then(Vec::new);
    let watcher = (is_recording || linked.is_some()).then(|| Watcher {
        region_ends: linked.map_or_default(|(_, region_ends)| region_ends),
        is_recording,
    });
    Embedding {
        strings: graph.bytecode_string_table(),
        observer: watcher.map(|it| Box::leak(Box::new(it)) as &dyn Observer),
        is_recorded: is_recording,
    }
    .install();
}

/// `bytecodeOrderStats()` of `bun:jsc`. False unless an order file has laid the bytecode out.
#[unsafe(no_mangle)]
extern "C" fn Bun__BytecodeOrder__statistics(
    region_ends: &mut [u32; REGION_COUNT],
    decoded: &mut [u64; 6],
) -> bool {
    let graph = crate::virtual_machine::standalone_module_graph();
    let Some((_, ends)) = graph.and_then(|graph| graph.linked_bytecode_payload()) else {
        return false;
    };
    *region_ends = ends;
    *decoded = DECODED.with(|decoded| decoded.each_ref().map(Cell::get));
    true
}

/// `BUN_BYTECODE_DIGEST_OUT=<path>`: decode everything every module's bytecode holds and write one sorted line per
/// module, `<path> <digest> <records>` (`- -` where the bytecode does not decode for the
/// module). Two builds of the same sources have equal digests however their bytecode is laid out.
#[inline(never)]
fn write_digests(graph: Graph) {
    bun_removable_features::removable_definition!(Interpreter, write_digests);
    let Some(path) = bun_core::env_var::BUN_BYTECODE_DIGEST_OUT.get_not_empty() else {
        return;
    };
    let mut lines: Vec<String> = Vec::new();
    let mut add = |name: &dyn core::fmt::Display, digest: Option<Digest>| {
        lines.push(match digest {
            Some(Digest { hash, records }) => format!("{name} {hash:016x} {records}\n"),
            None => format!("{name} - -\n"),
        });
    };
    graph.for_each_bytecode_module(&mut |module| {
        let text = (module.source.as_engine_string()).map_or_default(StringRef::retain);
        let (bytecode, entry) = (module.bytecode, module.bytecode_entry_offset);
        let digest = digest_of_chunk(&text, module.is_esm, bytecode, entry);
        add(&bstr::BStr::new(module.origin_path), digest);
    });
    let builtins = Builtins::parse(host_builtins()).ok();
    graph.for_each_builtin_bytecode(&mut |id, bytecode, entry| {
        let digest = builtins.as_ref().and_then(|builtins| {
            let text = builtins.module(id)?.source;
            digest_of_internal_module(text, builtins.source_stamp, bytecode, entry)
        });
        add(&format_args!("internal:{id}"), digest);
    });
    lines.sort();
    if let Err(err) = write_replacing(path, lines.concat().as_bytes()) {
        bun_core::Output::err(
            err,
            "failed to write the bytecode digests to <b>{}<r>",
            (bstr::BStr::new(path),),
        );
    }
}

fn output_path() -> Option<&'static [u8]> {
    bun_core::env_var::BUN_BYTECODE_ORDER_OUT.get_not_empty()
}

/// Once: a process that outlives the signal it sent itself has written its order file when it really exits.
pub(crate) fn write_at_exit(graph: Option<Graph>) {
    static WRITTEN: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
    let Some(graph) = graph else {
        return;
    };
    if graph.compiled_program().is_some() {
        crate::compiled_program::finish_order_recording();
        return;
    }
    if WRITTEN.swap(true, core::sync::atomic::Ordering::Relaxed) {
        return;
    }
    // Taking the recording ends it: digesting reads every string, which would count as read by the program.
    write_order_file(graph);
    write_digests(graph);
}

/// What every thread of the process recorded, as an order file names it: the engine knows the code it saw run by where
/// it starts in which of the executable's bytecode, and the names come from parsing the text all of it was compiled from.
#[inline(never)]
fn write_order_file(graph: Graph) {
    bun_removable_features::removable_definition!(Interpreter, write_order_file);
    let Some(path) = output_path() else {
        return;
    };
    let threads = READS.lock().take().unwrap_or_default();
    // Everything the executable has bytecode for: where that is, what it is called, and its text.
    let mut module_at: HashMap<EntryId, usize> = HashMap::default();
    let entry_id = |payload: &[u8], offset| EntryId {
        payload: payload.as_ptr().addr(),
        offset,
    };
    let mut module_names: Vec<&[u8]> = Vec::new();
    let mut chunks: Vec<(bun_core::String, bool)> = Vec::new();
    graph.for_each_bytecode_module(&mut |module| {
        let entry = entry_id(module.bytecode, module.bytecode_entry_offset);
        module_at.insert(entry, module_names.len());
        module_names.push(module.origin_path);
        chunks.push((module.source, module.is_esm));
    });
    // (Borrowed where the text is ASCII, which is when the executable has it as it was built.)
    let texts: Vec<_> = chunks.iter().map(|(source, _)| source.to_utf8()).collect();
    // A text imports a chunk by its path in the executable.
    let mut chunk_paths: Vec<&[u8]> = Vec::new();
    graph.for_each_path(&mut |path| chunk_paths.push(path));
    chunk_paths.sort_unstable();
    chunk_paths.dedup();
    let mut named: Vec<bytecode_order::Named<'_>> = texts
        .iter()
        .zip(&chunks)
        .map(|(text, &(_, is_esm))| bytecode_order::Named::Chunk {
            text: text.slice(),
            is_esm,
            chunk_paths: &chunk_paths,
        })
        .collect();
    let chunk_count = named.len();
    let builtins = Builtins::parse(host_builtins()).ok();
    graph.for_each_builtin_bytecode(&mut |id, payload, entry_offset| {
        if let Some(module) = builtins.as_ref().and_then(|builtins| builtins.module(id)) {
            module_at.insert(entry_id(payload, entry_offset), module_names.len());
            module_names.push(module.name);
            named.push(bytecode_order::Named::InternalModule(module.source));
        }
    });
    let names = bytecode_order::names_of_all(&named);
    if let Some(path) = bytecode_order::names_out() {
        let mut out = Vec::new();
        for (name, names) in module_names.iter().zip(&names) {
            bytecode_order::write_names_of(&mut out, name, names.as_ref());
        }
        if let Err(err) = write_replacing(path, &out) {
            bun_core::Output::err(err, "failed to write <b>{}<r>", (bstr::BStr::new(path),));
        }
    }
    for (name, names) in module_names.iter().zip(&names) {
        if names.is_none() {
            bun_core::warn!(
                "the bytecode order file cannot list the functions of <b>{}<r>: they have no names",
                bstr::BStr::new(name),
            );
        }
    }

    let names_at = |entry: &EntryId| names[*module_at.get(entry)?].as_ref();
    let mut recording = Recording::default();
    let mut was_usable: Vec<Option<bool>> = vec![None; names.len()];
    for reads in &threads {
        for (entry, is_usable) in &reads.entries {
            if let Some(&module) = module_at.get(entry) {
                *was_usable[module].get_or_insert_default() |= is_usable;
            }
            (recording.evaluated_modules).extend(names_at(entry).filter(|_| *is_usable));
        }
        let functions = reads.functions.iter();
        (recording.functions).extend(functions.filter_map(|it| Some((names_at(&it.0)?, it.1))));
        recording.strings.extend(&reads.strings);
    }
    // A module that ran from its source, its bytecode being for another, says nothing about what it ran: it is not
    // listed as not evaluated, nor its functions as not run.
    let listed: Vec<_> = (names.iter().zip(was_usable))
        .map(|(names, was_usable)| names.as_ref().filter(|_| was_usable != Some(false)))
        .collect();
    let (mut text, functions_without_name) = bytecode_order::write(&listed, &recording);
    if functions_without_name != 0 {
        bun_core::warn!(
            "the bytecode order file does not list {} functions the program ran: they have no names",
            functions_without_name,
        );
    }

    if chunk_count > 0 && names[..chunk_count].iter().all(Option::is_none) {
        bun_core::warn!(
            "the bytecode order file <b>{}<r> lists nothing: none of the program's code has names",
            bstr::BStr::new(path)
        );
        // Not what the path held before, which a build would take for this run's.
        text = format!(
            "{}\n{}: none of the program's code has names\n",
            bytecode_order::VERSION,
            bytecode_order::NOT_RECORDED
        )
        .into_bytes();
    }
    if let Err(err) = write_replacing(path, &text) {
        bun_core::Output::err(
            err,
            "failed to write the bytecode order file <b>{}<r>",
            (bstr::BStr::new(path),),
        );
    }
}

/// Writes a new file (0600, exclusive, unpredictable name) next to `path` and renames it over `path`, so a reader never
/// sees part of one and nothing that already exists at either name is written through. A directory at `path` stays
/// (`EISDIR`). `%p` in `path` is the pid.
fn write_replacing(path: &[u8], text: &[u8]) -> bun_sys::Maybe<()> {
    let pid = std::process::id();
    let mut final_path = Vec::with_capacity(path.len() + 8);
    let mut rest = path;
    while let Some(at) = bun_core::strings::index_of(rest, b"%p") {
        final_path.extend_from_slice(&rest[..at]);
        final_path.extend_from_slice(pid.to_string().as_bytes());
        rest = &rest[at + 2..];
    }
    final_path.extend_from_slice(rest);
    // The name of a directory, not of a file in one (`basename` would drop the separator).
    if final_path
        .last()
        .is_some_and(|&last| bun_paths::is_sep_native(last))
    {
        return Err(bun_sys::Error::from_code(
            bun_sys::E::EISDIR,
            bun_sys::Tag::open,
        ));
    }
    let name = bun_core::ZBox::from_bytes(bun_paths::basename(&final_path));
    let dir = bun_sys::Dir::open(bun_paths::dirname(&final_path).unwrap_or(b"."))?;

    let mut tmpname_buf = bun_paths::path_buffer_pool::get();
    let tmpname: &bun_core::ZStr =
        bun_resolver::fs::FileSystem::tmpname(b".order", &mut tmpname_buf[..], u64::from(pid))
            .map_err(|_| bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open))?;
    let tmpfile = bun_sys::Tmpfile::create_with_mode(dir.fd(), tmpname, 0o600)?;
    tmpfile.file.write_all(text)?;
    // Not `Tmpfile::finish`: that removes an empty directory that is in the way.
    bun_sys::renameat(&dir, tmpname, &dir, &name)?;
    tmpfile.keep();
    Ok(())
}

/// `bun:internal-for-testing`: what an order file calls the code of `text` (a `"module"` or `"script"` whose other chunks'
/// paths start with the third argument, a `"builtin"`, or the specifier of an `"internal"` module, undefined if there is
/// none), as `M <name>` and `<start> <kind> <name>` lines, or null for a text that has no names.
pub(crate) fn names_for_testing(
    text: &[u8],
    kind: BytecodeOrderTextKind,
    chunk_paths: Option<&[u8]>,
) -> BytecodeOrderNames {
    // One path to a line.
    let mut chunk_paths: Vec<&[u8]> = bun_core::strings::split(chunk_paths.unwrap_or(b""), b"\n")
        .filter(|path| !path.is_empty())
        .collect();
    chunk_paths.sort_unstable();
    let chunk = |is_esm| bytecode_order::Named::Chunk {
        text,
        is_esm,
        chunk_paths: &chunk_paths,
    };
    let names = match kind {
        BytecodeOrderTextKind::Module => chunk(true).names(),
        BytecodeOrderTextKind::Script => chunk(false).names(),
        BytecodeOrderTextKind::Builtin => bytecode_order::Named::InternalModule(text).names(),
        // `text` is the specifier of one of this executable's internal modules, which are all ASCII.
        BytecodeOrderTextKind::Internal => {
            let builtins = Builtins::parse(host_builtins()).ok();
            let Some(module) = builtins
                .as_ref()
                .and_then(|builtins| builtins.module(builtins.find(text)?))
            else {
                return BytecodeOrderNames::Unknown;
            };
            bytecode_order::Named::InternalModule(module.source).names()
        }
    };
    let Some(names) = names else {
        return BytecodeOrderNames::Unnamed;
    };
    let mut lines = Vec::new();
    bytecode_order::write_names(&mut lines, &names);
    BytecodeOrderNames::Lines(lines)
}

/// `bun:internal-for-testing`: what an executable would have for an internal module with that text. Calls `take` with
/// the bytecode and the strings, unless the text has an error.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__internalModuleBytecode(
    text: *const u8,
    length: usize,
    stamp: u32,
    context: *mut core::ffi::c_void,
    take: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize, *const u8, usize),
) {
    use bun_bundler::bytecode::{Generator, Source, StringTableBuilder};
    // SAFETY: the characters of a string that the caller holds.
    let source = Source::InternalModule(unsafe { bun_core::ffi::slice(text, length) }, stamp);
    let mut strings = StringTableBuilder::default();
    if let Some(code) = Generator::default().generate(source, u32::MAX, Some(&mut strings))
        && let Ok(strings) = strings.finish()
    {
        let (code, strings) = (
            (code.as_ptr(), code.len()),
            (strings.as_ptr(), strings.len()),
        );
        // SAFETY: the two go together, and it reads the bytes during the call.
        unsafe { take(context, code.0, code.1, strings.0, strings.1) };
    }
}
