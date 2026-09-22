//! `BUN_BYTECODE_ORDER_OUT=<path>` in a `--compile --bytecode` executable: record what every VM of the process (the main
//! thread's and each Worker's) reads out of the bytecode payload, and have the main thread write it at exit as a payload
//! order file (`bun_bundler::bytecode_order` reads it back
//! through `BUN_BYTECODE_ORDER_FILE`). `%p` in the path becomes the pid. Nothing is recorded without the variable.
//! Apart from that, in an executable built with an order file every VM counts the function bodies it decodes by the
//! region of the payload they are in (`bytecodeOrderStats()` of `bun:jsc`).

use crate::virtual_machine::VirtualMachine;
use crate::vm::VM;

bun_core::declare_scope!(BytecodeOrder, hidden);

unsafe extern "C" {
    fn Bun__BytecodeOrder__enableRecording(vm: *mut VM);
    fn Bun__BytecodeOrder__setLinkedPayload(
        vm: *mut VM,
        payload: *const u8,
        payload_size: usize,
        region_ends: *const u32,
        region_count: usize,
    );
    fn Bun__BytecodeOrderFile__create() -> *mut core::ffi::c_void;
    fn Bun__BytecodeOrderFile__addModule(
        file: *mut core::ffi::c_void,
        vm: *mut VM,
        source: *const bun_core::String,
        origin_path: *const bun_core::String,
        is_module: bool,
        bytecode: *mut u8,
        bytecode_len: usize,
        entry_offset: u32,
    ) -> bool;
    fn Bun__BytecodeOrderFile__addInternalModule(
        file: *mut core::ffi::c_void,
        vm: *mut VM,
        id: u32,
        bytecode: *mut u8,
        bytecode_len: usize,
        entry_offset: u32,
    ) -> bool;
    fn Bun__BytecodeOrderFile__finish(
        file: *mut core::ffi::c_void,
        ctx: *mut core::ffi::c_void,
        append: unsafe extern "C" fn(*mut core::ffi::c_void, *const u8, usize),
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
    let Some(path) = bun_core::env_var::BUN_BYTECODE_DIGEST_OUT
        .get()
        .filter(|path| !path.is_empty())
    else {
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
        bun_core::scoped_log!(
            BytecodeOrder,
            "cannot write {}: {}",
            bstr::BStr::new(path),
            err
        );
    }
}

fn output_path() -> Option<&'static [u8]> {
    bun_core::env_var::BUN_BYTECODE_ORDER_OUT
        .get()
        .filter(|path| !path.is_empty())
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

pub(crate) fn write_at_exit(
    vm: &VirtualMachine,
    graph: Option<&'static dyn bun_resolver::StandaloneModuleGraph>,
) {
    let Some(graph) = graph else {
        return;
    };
    write_order_file(vm, graph);
    write_digests(vm, graph);
}

/// What every VM of the process recorded, named as an order file names it. A recorder knows code by where it is in the
/// executable; its name takes the code of everything nested in it, so all of the executable's bytecode is decoded here,
/// once the program is done (`JSC::BytecodeOrderFile`).
fn write_order_file(vm: &VirtualMachine, graph: &'static dyn bun_resolver::StandaloneModuleGraph) {
    let Some(path) = output_path() else {
        return;
    };
    // SAFETY: no preconditions; freed by `Bun__BytecodeOrderFile__finish`.
    let file = unsafe { Bun__BytecodeOrderFile__create() };
    graph.for_each_bytecode_module(&mut |module| {
        let origin_path = bun_core::String::clone_utf8(module.origin_path);
        // A module whose bytecode does not decode is left out.
        // SAFETY: `jsc_vm` is this thread's live VM; the payload is a live section of the executable.
        let _ = unsafe {
            Bun__BytecodeOrderFile__addModule(
                file,
                vm.jsc_vm,
                &raw const module.source,
                &raw const origin_path,
                module.is_esm,
                module.bytecode.cast::<u8>(),
                module.bytecode.len(),
                module.bytecode_entry_offset,
            )
        };
    });
    graph.for_each_builtin_bytecode(&mut |id, bytecode, entry_offset| {
        // SAFETY: as above.
        let _ = unsafe {
            Bun__BytecodeOrderFile__addInternalModule(
                file,
                vm.jsc_vm,
                id,
                bytecode.cast::<u8>(),
                bytecode.len(),
                entry_offset,
            )
        };
    });
    let mut text = Vec::<u8>::new();
    unsafe extern "C" fn append(ctx: *mut core::ffi::c_void, bytes: *const u8, len: usize) {
        // SAFETY: `ctx` is `&mut Vec<u8>`; `bytes` valid for `len`.
        unsafe {
            (*ctx.cast::<Vec<u8>>()).extend_from_slice(core::slice::from_raw_parts(bytes, len))
        };
    }
    // SAFETY: the callback receives our `&mut text`; `file` is not used again.
    unsafe { Bun__BytecodeOrderFile__finish(file, (&raw mut text).cast(), append) };

    if let Err(err) = write_replacing(path, &text) {
        bun_core::scoped_log!(
            BytecodeOrder,
            "cannot write {}: {}",
            bstr::BStr::new(path),
            err
        );
    }
}

/// Writes a new file (0600, exclusive, unpredictable name) next to `path` and renames it over `path`, so a reader never
/// sees part of one and nothing that already exists at either name is written through. `%p` in `path` is the pid.
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
    let (dir, name) = match final_path
        .iter()
        .rposition(|&b| bun_paths::is_sep_native(b))
    {
        Some(at) => (&final_path[..=at], &final_path[at + 1..]),
        None => (&b"."[..], &final_path[..]),
    };
    let dir = bun_core::ZBox::from_bytes(dir);
    let name = bun_core::ZBox::from_bytes(name);
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
    let mut tmpfile = bun_sys::Tmpfile::create_with_mode(dir_fd, tmpname, 0o600)?;
    let _close = bun_sys::CloseOnDrop::new(tmpfile.fd);
    // ManuallyDrop: the fd is owned by `_close` above.
    let file = core::mem::ManuallyDrop::new(bun_sys::File::from_fd(tmpfile.fd));
    let result = file.write_all(text).and_then(|()| tmpfile.finish(&name));
    if result.is_err() {
        let _ = bun_sys::unlinkat(dir_fd, tmpname);
    }
    result
}
