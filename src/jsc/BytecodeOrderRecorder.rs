//! `BUN_BYTECODE_ORDER_OUT=<path>` in a `--compile --bytecode` executable: record what every VM of the process (the main
//! thread's and each Worker's) reads out of the bytecode payload, and have the main thread write it at exit as a payload
//! order file (`bun_bundler::bytecode_order` reads it back
//! for `--bytecode-order`). `%p` in the path becomes the pid. Nothing is recorded without the variable.
//! Apart from that, in an executable built with an order file every VM counts the function bodies it decodes by the
//! region of the payload they are in (`bytecodeOrderStats()` of `bun:jsc`).

use bun_bundler::bytecode_order::{self, CodeNames, RecordedFunction, RecordedSource, Recording};

use crate::virtual_machine::VirtualMachine;
use crate::vm::VM;

unsafe extern "C" {
    fn Bun__BytecodeOrder__enableRecording(vm: *mut VM);
    fn Bun__BytecodeOrder__setLinkedPayload(
        vm: *mut VM,
        payload: *const u8,
        payload_size: usize,
        region_ends: *const u32,
        region_count: usize,
    );
    fn Bun__BytecodeOrder__takeRecording(
        ctx: *mut core::ffi::c_void,
        take: unsafe extern "C" fn(
            ctx: *mut core::ffi::c_void,
            sources: *const RecordedSource,
            source_count: usize,
            functions: *const RecordedFunction,
            function_count: usize,
            evaluated_sources: *const u32,
            evaluated_source_count: usize,
            rejected_sources: *const u32,
            rejected_source_count: usize,
            strings: *const u64,
            string_count: usize,
        ),
    );
    fn Bun__BytecodeOrder__digestInternalModule(
        vm: *mut VM,
        id: u32,
        bytecode: *mut u8,
        bytecode_size: usize,
        entry_offset: u32,
        digest: *mut u64,
        code_blocks: *mut u32,
    ) -> bool;
}

unsafe extern "C" {
    fn Bun__BytecodeOrder__digestModule(
        vm: *mut VM,
        source: &bun_core::String,
        origin_path: &bun_core::String,
        is_module: bool,
        bytecode: *mut u8,
        bytecode_size: usize,
        entry_offset: u32,
        digest: *mut u64,
        code_blocks: *mut u32,
    ) -> bool;
}

/// `BUN_BYTECODE_DIGEST_OUT=<path>`: decode everything every module's bytecode holds and write one sorted line per
/// module, `<path the bytecode is keyed on> <digest> <code blocks>` (`- -` where the bytecode does not decode for the
/// module). Two builds of the same sources have equal digests however their bytecode is laid out.
fn write_digests(vm: &VirtualMachine, graph: &'static dyn bun_resolver::StandaloneModuleGraph) {
    let Some(path) = bun_core::env_var::BUN_BYTECODE_DIGEST_OUT.get_not_empty() else {
        return;
    };
    let mut lines: Vec<String> = Vec::new();
    graph.for_each_bytecode_module(&mut |module| {
        let origin_path = bun_core::String::clone_utf8(module.origin_path);
        let (mut digest, mut code_blocks) = (0u64, 0u32);
        // SAFETY: `jsc_vm` is this thread's live VM; the payload is a live section of the executable.
        let ok = unsafe {
            Bun__BytecodeOrder__digestModule(
                vm.jsc_vm,
                &module.source,
                &origin_path,
                module.is_esm,
                module.bytecode.cast::<u8>(),
                module.bytecode.len(),
                module.bytecode_entry_offset,
                &raw mut digest,
                &raw mut code_blocks,
            )
        };
        let name = bstr::BStr::new(module.origin_path);
        lines.push(if ok {
            format!("{name} {digest:016x} {code_blocks}\n")
        } else {
            format!("{name} - -\n")
        });
    });
    graph.for_each_builtin_bytecode(&mut |id, bytecode, entry_offset| {
        let (mut digest, mut code_blocks) = (0u64, 0u32);
        // SAFETY: as above.
        let ok = unsafe {
            Bun__BytecodeOrder__digestInternalModule(
                vm.jsc_vm,
                id,
                bytecode.cast::<u8>(),
                bytecode.len(),
                entry_offset,
                &raw mut digest,
                &raw mut code_blocks,
            )
        };
        lines.push(if ok {
            format!("internal:{id} {digest:016x} {code_blocks}\n")
        } else {
            format!("internal:{id} - -\n")
        });
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

/// For every VM, once its `DecoderStringTable` (if the executable has one) is installed.
pub(crate) fn init_vm(
    vm: &VirtualMachine,
    graph: &'static dyn bun_resolver::StandaloneModuleGraph,
) {
    // `bytecodeOrderStats()` of `bun:jsc`: this VM counts the function bodies it decodes by the payload's regions.
    if let Some((payload, region_ends)) = graph.linked_bytecode_payload() {
        // SAFETY: `jsc_vm` is this thread's live VM; the payload is a live section of the executable.
        unsafe {
            Bun__BytecodeOrder__setLinkedPayload(
                vm.jsc_vm,
                payload.cast::<u8>(),
                payload.len(),
                region_ends.as_ptr(),
                region_ends.len(),
            )
        };
    }
    enable_if_requested(vm);
}

fn enable_if_requested(vm: &VirtualMachine) {
    if output_path().is_none() {
        return;
    }
    // SAFETY: `jsc_vm` is this thread's live VM.
    unsafe { Bun__BytecodeOrder__enableRecording(vm.jsc_vm) };
}

/// Once: a process that outlives the signal it sent itself has written its order file when it really exits.
pub(crate) fn write_at_exit(
    vm: &VirtualMachine,
    graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
) {
    static WRITTEN: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);
    let Some(graph) = graph else {
        return;
    };
    if WRITTEN.swap(true, core::sync::atomic::Ordering::Relaxed) {
        return;
    }
    // Taking the recording ends it: digesting reads every string, which would count as read by the program.
    write_order_file(graph);
    write_digests(vm, graph);
}

/// What every VM of the process recorded, as an order file names it: JavaScriptCore knows the code it saw run by where
/// it starts in which of the executable's bytecode, and the names come from parsing the text all of it was compiled from.
fn write_order_file(graph: &'static dyn bun_resolver::StandaloneModuleGraph) {
    let Some(path) = output_path() else {
        return;
    };
    // Everything the executable has bytecode for: where that is, what it is called, and its text.
    let mut bytecode: Vec<RecordedSource> = Vec::new();
    let mut module_names: Vec<&[u8]> = Vec::new();
    let mut chunks: Vec<(bun_core::String, bool)> = Vec::new();
    graph.for_each_bytecode_module(&mut |module| {
        bytecode.push(RecordedSource {
            payload: module.bytecode.cast::<u8>().cast_const(),
            entry_offset: module.bytecode_entry_offset,
        });
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
    let builtins = bun_exe_format::builtins::Builtins::parse(
        crate::cached_bytecode::__bun_jsc_host_builtins(),
    )
    .ok();
    graph.for_each_builtin_bytecode(&mut |id, payload, entry_offset| {
        if let Some(module) = builtins.as_ref().and_then(|builtins| builtins.module(id)) {
            bytecode.push(RecordedSource {
                payload: payload.cast::<u8>().cast_const(),
                entry_offset,
            });
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

    struct Context<'a> {
        bytecode: &'a [RecordedSource],
        names: &'a [Option<CodeNames>],
        text: Vec<u8>,
        functions_without_name: usize,
    }
    unsafe extern "C" fn take(
        ctx: *mut core::ffi::c_void,
        sources: *const RecordedSource,
        source_count: usize,
        functions: *const RecordedFunction,
        function_count: usize,
        evaluated_sources: *const u32,
        evaluated_source_count: usize,
        rejected_sources: *const u32,
        rejected_source_count: usize,
        strings: *const u64,
        string_count: usize,
    ) {
        // SAFETY: `ctx` is the `Context` below; each array is valid for its count for the duration of the call.
        let (ctx, sources, functions, evaluated_sources, rejected_sources, strings) = unsafe {
            (
                &mut *ctx.cast::<Context<'_>>(),
                bun_core::ffi::slice(sources, source_count),
                bun_core::ffi::slice(functions, function_count),
                bun_core::ffi::slice(evaluated_sources, evaluated_source_count),
                bun_core::ffi::slice(rejected_sources, rejected_source_count),
                bun_core::ffi::slice(strings, string_count),
            )
        };
        // Bytecode that is not one of the executable's modules is the runtime's own.
        let names_of_source: Vec<Option<&CodeNames>> = sources
            .iter()
            .map(|source| {
                let module = ctx
                    .bytecode
                    .iter()
                    .position(|bytecode| bytecode == source)?;
                ctx.names[module].as_ref()
            })
            .collect();
        // A module that ran from its source, its bytecode being for another, says nothing about what it ran: it is
        // not listed as not evaluated, nor its functions as not run.
        let ran_from_source = |module: usize| {
            let is_module = |source: &u32| {
                sources
                    .get(*source as usize)
                    .is_some_and(|source| ctx.bytecode[module] == *source)
            };
            rejected_sources.iter().any(is_module) && !evaluated_sources.iter().any(is_module)
        };
        let listed: Vec<Option<&CodeNames>> = ctx
            .names
            .iter()
            .enumerate()
            .map(|(module, names)| names.as_ref().filter(|_| !ran_from_source(module)))
            .collect();
        (ctx.text, ctx.functions_without_name) = bytecode_order::write(
            &listed,
            &Recording {
                sources: &names_of_source,
                functions,
                evaluated_sources,
                strings,
            },
        );
    }
    let mut context = Context {
        bytecode: &bytecode,
        names: &names,
        text: Vec::new(),
        functions_without_name: 0,
    };
    // SAFETY: `take` gets our `&mut context`, during the call only.
    unsafe { Bun__BytecodeOrder__takeRecording((&raw mut context).cast(), take) };
    if context.functions_without_name != 0 {
        bun_core::warn!(
            "the bytecode order file does not list {} functions the program ran: they have no names",
            context.functions_without_name,
        );
    }

    if chunk_count > 0 && names[..chunk_count].iter().all(Option::is_none) {
        bun_core::warn!(
            "the bytecode order file <b>{}<r> lists nothing: none of the program's code has names",
            bstr::BStr::new(path)
        );
        // Not what the path held before, which a build would take for this run's.
        context.text = format!(
            "{}\n{}: none of the program's code has names\n",
            bytecode_order::VERSION,
            bytecode_order::NOT_RECORDED
        )
        .into_bytes();
    }
    if let Err(err) = write_replacing(path, &context.text) {
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
    let dir = bun_core::ZBox::from_bytes(bun_paths::dirname(&final_path).unwrap_or(b"."));
    let name = bun_core::ZBox::from_bytes(bun_paths::basename(&final_path));
    let dir_fd = bun_sys::openat(
        bun_core::Fd::cwd(),
        &dir,
        bun_sys::O::DIRECTORY | bun_sys::O::RDONLY | bun_sys::O::CLOEXEC,
        0,
    )?;
    let _close_dir = bun_sys::CloseOnDrop::new(dir_fd);

    let mut tmpname_buf = bun_paths::path_buffer_pool::get();
    let tmpname: &bun_core::ZStr =
        bun_resolver::fs::FileSystem::tmpname(b".order", &mut tmpname_buf[..], u64::from(pid))
            .map_err(|_| bun_sys::Error::from_code(bun_sys::E::ENAMETOOLONG, bun_sys::Tag::open))?;
    let tmpfile = bun_sys::Tmpfile::create_with_mode(dir_fd, tmpname, 0o600)?;
    let _close = bun_sys::CloseOnDrop::new(tmpfile.fd);
    // Not `Tmpfile::finish`: that removes an empty directory that is in the way.
    let result = bun_sys::File::borrow(&tmpfile.fd)
        .write_all(text)
        .and_then(|()| bun_sys::renameat(dir_fd, tmpname, dir_fd, &name));
    if result.is_err() {
        let _ = bun_sys::unlinkat(dir_fd, tmpname);
    }
    result
}

/// `bun:internal-for-testing`: what an order file calls the code of `text` (a `"module"` or `"script"` whose other chunks'
/// paths start with the third argument, a `"builtin"`, or the specifier of an `"internal"` module, undefined if there is
/// none), as `M <name>` and `<start> <kind> <name>` lines, or null for a text that has no names.
#[crate::host_fn]
pub fn names_for_testing(
    global: &crate::JSGlobalObject,
    frame: &crate::CallFrame,
) -> crate::JsResult<crate::JSValue> {
    let text = frame.argument(0).to_utf8(global)?;
    let kind = frame.argument(1).to_utf8(global)?;
    let chunk_paths = frame.argument(2);
    let chunk_paths = if chunk_paths.is_undefined() {
        None
    } else {
        Some(chunk_paths.to_utf8(global)?)
    };
    // One path to a line.
    let mut chunk_paths: Vec<&[u8]> = bun_core::strings::split(
        chunk_paths.as_ref().map_or(&b""[..], |paths| paths.slice()),
        b"\n",
    )
    .filter(|path| !path.is_empty())
    .collect();
    chunk_paths.sort_unstable();
    let chunk = |is_esm| bytecode_order::Named::Chunk {
        text: text.slice(),
        is_esm,
        chunk_paths: &chunk_paths,
    };
    let names = match kind.slice() {
        b"module" => chunk(true).names(),
        b"script" => chunk(false).names(),
        b"builtin" => bytecode_order::Named::InternalModule(text.slice()).names(),
        // `text` is the specifier of one of this executable's internal modules, which are all ASCII.
        b"internal" => {
            let builtins = bun_exe_format::builtins::Builtins::parse(
                crate::cached_bytecode::__bun_jsc_host_builtins(),
            )
            .ok();
            let Some(module) = builtins
                .as_ref()
                .and_then(|builtins| builtins.module(builtins.find(text.slice())?))
            else {
                return Ok(crate::JSValue::UNDEFINED);
            };
            bytecode_order::Named::InternalModule(module.source).names()
        }
        _ => {
            return Err(global.throw(format_args!(
                "expected \"module\", \"script\", \"builtin\" or \"internal\""
            )));
        }
    };
    let Some(names) = names else {
        return Ok(crate::JSValue::NULL);
    };
    let mut lines = Vec::new();
    bytecode_order::write_names(&mut lines, &names);
    crate::bun_string_jsc::create_utf8_for_js(global, &lines)
}
