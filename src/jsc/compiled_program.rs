use core::sync::atomic::Ordering;
use std::collections::BTreeSet;

use bun_aot::ir::generated::{AdmittedCode, ImageVerdict};
use bun_core::{Fd, ZBox};
use bun_exe_format::identity::{HostDescription, IdentityError, find_process_identity};
use bun_options_types::standalone_path::is_bun_standalone_file_path;
use bun_resolver::StandaloneModuleGraph;
use bun_resolver::compiled_program::{CompiledEntryPoint, CompiledProgram};
use bun_sys::O;

use crate::virtual_machine::standalone_module_graph;
use crate::{JSGlobalObject, JSValue};

const NO_LOG_DESCRIPTOR: isize = -1;

#[used]
#[cfg_attr(target_vendor = "apple", unsafe(link_section = "__TEXT,__bun_aot"))]
#[cfg_attr(windows, unsafe(link_section = ".bunaot"))]
#[cfg_attr(
    not(any(target_vendor = "apple", windows)),
    unsafe(link_section = ".bun_aot")
)]
static HOST_DESCRIPTION: HostDescription = HostDescription::new(bun_core::env::GIT_SHA);

#[repr(C)]
struct Bytes {
    ptr: *const u8,
    len: usize,
}

#[repr(C)]
struct ImageFileArgument {
    descriptor: isize,
    offset: i64,
}

unsafe extern "C" {
    fn Bun__AOT__useImage(
        image: Bytes,
        file_or_null: *const ImageFileArgument,
        identity: *const u8,
    ) -> u32;
    fn Bun__AOT__admittedCode(image: Bytes, admitted: *mut u32) -> bool;
    fn Bun__AOT__admitsUnknownJavaScript(image: Bytes) -> bool;
    fn Bun__AOT__omitsFunctionSource(image: Bytes) -> bool;
    safe fn Bun__AOT__imageCode() -> Bytes;
    safe fn Bun__AOT__setMismatchLog(descriptor: isize, is_json: bool);
    safe fn Bun__AOT__setMismatchLogFormat(is_json: bool);
    safe fn Bun__AOT__setVerbose(is_verbose: bool);
    safe fn Bun__isCompiledProgramFile(path: &bun_core::String) -> bool;
    safe fn Bun__AOT__entryPointIsCommonJS(global: &JSGlobalObject) -> bool;
    safe fn Bun__AOT__errorIfCodeOutsideImageIsRefused(
        global: &JSGlobalObject,
        code: crate::ErrCode,
        path: &bun_core::String,
    ) -> JSValue;
    safe fn Bun__AOT__errorIfHostObjectOutsideImageIsRefused(
        global: &JSGlobalObject,
        code: crate::ErrCode,
        path: &bun_core::String,
    ) -> JSValue;
}

pub fn compiled_program() -> Option<&'static CompiledProgram> {
    standalone_module_graph()?.compiled_program()
}

pub fn runs_in_place() -> bool {
    compiled_program().is_some_and(|program| program.preserves_source_paths)
}

fn image_of(program: &CompiledProgram) -> Bytes {
    Bytes {
        ptr: program.image.as_ptr(),
        len: program.image.len(),
    }
}

/// Answers before `use_image` has run. `None`: `use_image` refuses the image.
pub fn admitted_code_of(program: &CompiledProgram) -> Option<AdmittedCode> {
    let mut admitted = 0u32;
    // SAFETY: the engine reads the image and writes one word through the pointer before it returns.
    let has_header = unsafe { Bun__AOT__admittedCode(image_of(program), &raw mut admitted) };
    has_header.then(|| AdmittedCode::from_wire(admitted).unwrap_or_default())
}

/// Whether the compiler allowed for script and machine code that it did not see.
pub fn admits_unknown_javascript(program: &CompiledProgram) -> bool {
    // SAFETY: the engine reads the image before it returns.
    unsafe { Bun__AOT__admitsUnknownJavaScript(image_of(program)) }
}

/// Whether the program was built with `--no-compile-function-source`.
pub fn omits_function_source(program: &CompiledProgram) -> bool {
    // SAFETY: the engine reads the image before it returns.
    unsafe { Bun__AOT__omitsFunctionSource(image_of(program)) }
}

/// Whether this executable can run a module of Bun's library that the program does not use.
pub fn can_load_unused_library_modules() -> bool {
    if !bun_removable_features::RuntimeRequirement::WholeRuntime.is_available() {
        return false;
    }
    let Some((program, admitted)) =
        compiled_program().and_then(|program| Some((program, admitted_code_of(program)?)))
    else {
        return true;
    };
    admitted.contains(AdmittedCode::INSPECTOR) && !omits_function_source(program)
}

pub fn find_entry_point_by_source_path(path: &[u8]) -> Option<&'static CompiledEntryPoint> {
    compiled_program()?.entry_point_by_source_path(path)
}

pub fn find_entry_point_by_module_path(path: &[u8]) -> Option<&'static CompiledEntryPoint> {
    compiled_program()?.entry_point_by_module_path(path)
}

pub fn module_key(entry: &'static CompiledEntryPoint) -> &'static [u8] {
    standalone_module_graph().map_or(entry.source_path, |graph| module_key_in(graph, entry))
}

pub fn entry_module_key<'a>(path: &'a [u8]) -> &'a [u8] {
    standalone_module_graph().map_or(path, |graph| entry_module_key_in(graph, path))
}

fn module_key_in(
    graph: &'static dyn StandaloneModuleGraph,
    entry: &'static CompiledEntryPoint,
) -> &'static [u8] {
    let program = graph.compiled_program();
    match program.is_some_and(|program| program.preserves_source_paths) {
        true => entry.source_path,
        false => entry.module_path,
    }
}

fn entry_module_key_in<'a>(graph: &'static dyn StandaloneModuleGraph, path: &'a [u8]) -> &'a [u8] {
    let entry = if is_bun_standalone_file_path(path) {
        graph.compiled_entry_point(path)
    } else {
        let program = graph.compiled_program();
        program.and_then(|program| program.entry_point_by_source_path(path))
    };
    match entry {
        Some(entry) => module_key_in(graph, entry),
        None => path,
    }
}

pub fn is_compiled_module(path: &[u8]) -> bool {
    compiled_program().is_some() && Bun__isCompiledProgramFile(&bun_core::String::from_bytes(path))
}

/// The resolver keeps what it answers for as long as the process lives, so each path is copied once.
fn find_module_path(path: &[u8]) -> Option<&'static [u8]> {
    static PATHS: bun_threading::Guarded<BTreeSet<&'static [u8]>> =
        bun_threading::Guarded::new(BTreeSet::new());
    if !Bun__isCompiledProgramFile(&bun_core::String::from_bytes(path)) {
        return None;
    }
    let mut paths = PATHS.lock();
    if let Some(&kept) = paths.get(path) {
        return Some(kept);
    }
    let kept: &'static [u8] = Box::leak(Box::from(path));
    paths.insert(kept);
    Some(kept)
}

/// `path` names JavaScript, TypeScript, WebAssembly or a native addon that is not compiled into the executable.
pub fn error_if_code_outside_image_is_refused(
    global: &JSGlobalObject,
    code: crate::ErrCode,
    path: &bun_core::String,
) -> Option<JSValue> {
    compiled_program()?;
    let error = Bun__AOT__errorIfCodeOutsideImageIsRefused(global, code, path);
    (!error.is_empty()).then_some(error)
}

/// `path` names a file that loads as a database or a page.
pub fn error_if_host_object_outside_image_is_refused(
    global: &JSGlobalObject,
    code: crate::ErrCode,
    path: &bun_core::String,
) -> Option<JSValue> {
    compiled_program()?;
    let error = Bun__AOT__errorIfHostObjectOutsideImageIsRefused(global, code, path);
    (!error.is_empty()).then_some(error)
}

pub fn entry_point_is_commonjs(global: &JSGlobalObject) -> bool {
    compiled_program().is_some() && Bun__AOT__entryPointIsCommonJS(global)
}

#[cfg(target_os = "linux")]
mod write_execute {
    const PR_SET_MDWE: libc::c_int = 65;
    const PR_GET_MDWE: libc::c_int = 66;
    const PR_MDWE_REFUSE_EXEC_GAIN: libc::c_ulong = 1;
    const PR_MDWE_NO_INHERIT: libc::c_ulong = 2;
    const UNUSED: libc::c_ulong = 0;

    static IS_FILTERED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

    fn is_denied_by_the_kernel() -> bool {
        // SAFETY: the request takes and returns integers only.
        let bits = unsafe { libc::prctl(PR_GET_MDWE, UNUSED, UNUSED, UNUSED, UNUSED) };
        bits > 0 && bits as libc::c_ulong & PR_MDWE_REFUSE_EXEC_GAIN != 0
    }

    pub(super) fn is_denied() -> bool {
        IS_FILTERED.load(core::sync::atomic::Ordering::Relaxed) || is_denied_by_the_kernel()
    }

    #[cfg(bun_hardened)]
    fn executable_segments() -> Vec<core::ops::Range<u64>> {
        unsafe extern "C" fn collect(
            info: *mut libc::dl_phdr_info,
            _size: libc::size_t,
            found: *mut libc::c_void,
        ) -> libc::c_int {
            // SAFETY: the loader hands over a valid record, and `found` is the vector below.
            let (info, found) =
                unsafe { (&*info, &mut *found.cast::<Vec<core::ops::Range<u64>>>()) };
            if info.dlpi_phdr.is_null() {
                return 0;
            }
            // SAFETY: the record says how many program headers lie there.
            let headers = unsafe {
                core::slice::from_raw_parts(info.dlpi_phdr, usize::from(info.dlpi_phnum))
            };
            for header in headers {
                if header.p_type == libc::PT_LOAD && header.p_flags & libc::PF_X != 0 {
                    let start = info.dlpi_addr.wrapping_add(header.p_vaddr);
                    found.push(start..start.wrapping_add(header.p_memsz));
                }
            }
            0
        }
        let mut found: Vec<core::ops::Range<u64>> = Vec::new();
        // SAFETY: `collect` only reads what it is given and writes `found`, which outlives the call.
        unsafe { libc::dl_iterate_phdr(Some(collect), (&raw mut found).cast()) };
        found
    }

    #[cfg(bun_hardened)]
    fn install(program: &[bun_exe_format::executable_memory_filter::Instruction]) -> bool {
        const SET_MODE_FILTER: libc::c_ulong = 1;
        const ALL_THREADS: libc::c_ulong = 1;
        let filter = libc::sock_fprog {
            len: program.len() as libc::c_ushort,
            filter: program.as_ptr().cast_mut().cast(),
        };
        // SAFETY: the kernel copies the program, which has the layout of `sock_filter`, before the call returns.
        unsafe {
            libc::prctl(
                libc::PR_SET_NO_NEW_PRIVS,
                1 as libc::c_ulong,
                UNUSED,
                UNUSED,
                UNUSED,
            ) == 0
                && libc::syscall(
                    libc::SYS_seccomp,
                    SET_MODE_FILTER,
                    ALL_THREADS,
                    &raw const filter,
                ) == 0
        }
    }

    #[cfg(bun_hardened)]
    pub(super) fn refuse_new_executable_memory(image_code: core::ops::Range<u64>) {
        use bun_exe_format::executable_memory_filter::{Libraries, program};
        use bun_removable_features::{Feature, is_removed};
        let libraries = match [
            Feature::Ffi,
            Feature::NativeAddons,
            Feature::SqliteExtensions,
        ]
        .into_iter()
        .all(is_removed)
        {
            true => Libraries::AreNeverLoaded,
            false => Libraries::MayBeLoaded,
        };
        let mut code_of_this_process = executable_segments();
        code_of_this_process.push(image_code);
        let program = program(&code_of_this_process, libraries);
        IS_FILTERED.store(install(&program), core::sync::atomic::Ordering::Relaxed);
    }

    /// Kernels before 6.7 reject `PR_MDWE_NO_INHERIT`, and child processes may need a JIT.
    pub(super) fn deny() {
        if is_denied_by_the_kernel() {
            return;
        }
        let bits = match cfg!(bun_hardened) {
            true => PR_MDWE_REFUSE_EXEC_GAIN,
            false => PR_MDWE_REFUSE_EXEC_GAIN | PR_MDWE_NO_INHERIT,
        };
        // SAFETY: the request takes and returns integers only.
        unsafe { libc::prctl(PR_SET_MDWE, bits, UNUSED, UNUSED, UNUSED) };
    }
}

#[cfg(not(target_os = "linux"))]
mod write_execute {
    pub(super) fn is_denied() -> bool {
        false
    }

    pub(super) fn deny() {}
}

pub fn is_write_execute_memory_denied() -> bool {
    write_execute::is_denied()
}

pub(crate) fn use_image(graph: &'static dyn StandaloneModuleGraph) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    let Some(program) = graph.compiled_program() else {
        return;
    };
    ONCE.call_once(|| {
        // Keeps the linker from dropping it.
        core::hint::black_box(&raw const HOST_DESCRIPTION);
        bun_resolve_builtins::seal_internals();
        set_mismatch_log();
        let is_verbose = bun_core::env_var::BUN_AOT_VERBOSE.get().unwrap_or(false);
        Bun__AOT__setVerbose(is_verbose);
        let identity = match find_process_identity() {
            Ok(identity) => identity,
            Err(error) => exit_with(identity_error_sentence(error)),
        };
        let file = program.backing_file.as_ref().map(|file| ImageFileArgument {
            descriptor: file.descriptor,
            offset: file.offset,
        });
        // SAFETY: the image is part of the `'static` graph, which is never unmapped. `file` and
        // `identity` outlive the call.
        let raw_verdict = unsafe {
            Bun__AOT__useImage(
                image_of(program),
                file.as_ref().map_or(core::ptr::null(), core::ptr::from_ref),
                identity.as_ptr(),
            )
        };
        let verdict = ImageVerdict::from_wire(raw_verdict).unwrap_or(ImageVerdict::Unsupported);
        if let Some(sentence) = sentence_of(verdict) {
            exit_with(sentence);
        }
        write_execute::deny();
        #[cfg(all(
            target_os = "linux",
            any(target_arch = "x86_64", target_arch = "aarch64"),
            bun_hardened
        ))]
        {
            let code = Bun__AOT__imageCode();
            write_execute::refuse_new_executable_memory(
                code.ptr as u64..code.ptr as u64 + code.len as u64,
            );
        }
        program.set_module_lookup(find_module_path);
        bun_crash_handler::report_aborts();
        if is_verbose {
            print_image_summary(program.image.len());
        }
        bun_analytics::features::aot.fetch_add(1, Ordering::Relaxed);
    });
}

fn image_summary(image_size: usize, code_size: usize, code_address: usize) -> String {
    format!("[aot] image: {image_size} bytes, {code_size} of code at {code_address:#x}")
}

fn print_image_summary(image_size: usize) {
    let code = Bun__AOT__imageCode();
    bun_core::Output::print_errorln(image_summary(image_size, code.len, code.ptr as usize));
    bun_core::Output::flush();
}

#[derive(Debug, PartialEq, Eq)]
enum LogRequest<'a> {
    Off,
    FormatOnly { is_json: bool },
    StandardError { is_json: bool },
    File { path: &'a [u8], is_json: bool },
}

fn is_json_format(format: Option<&[u8]>) -> bool {
    matches!(format, Some(b"json"))
}

fn mismatch_log_request<'a>(
    destination: Option<&'a [u8]>,
    format: Option<&[u8]>,
) -> Option<LogRequest<'a>> {
    match destination {
        None => format.map(|_| LogRequest::FormatOnly {
            is_json: is_json_format(format),
        }),
        Some(b"off") => Some(LogRequest::Off),
        Some(b"stderr") => Some(LogRequest::StandardError {
            is_json: is_json_format(format),
        }),
        Some(path) => Some(LogRequest::File {
            path,
            is_json: format.is_none() || is_json_format(format),
        }),
    }
}

fn native_descriptor(fd: Fd) -> isize {
    fd.native() as isize
}

fn set_mismatch_log() {
    let destination = bun_core::env_var::BUN_AOT_TYPE_MISMATCH_LOG.get_not_empty();
    let format = bun_core::env_var::BUN_AOT_TYPE_MISMATCH_LOG_FORMAT.get_not_empty();
    let Some(request) = mismatch_log_request(destination, format) else {
        return;
    };
    let (descriptor, is_json) = match request {
        LogRequest::FormatOnly { is_json } => return Bun__AOT__setMismatchLogFormat(is_json),
        LogRequest::Off => (NO_LOG_DESCRIPTOR, false),
        LogRequest::StandardError { is_json } => (native_descriptor(Fd::stderr()), is_json),
        LogRequest::File { path, is_json } => {
            let flags = O::WRONLY | O::CREAT | O::APPEND | O::CLOEXEC;
            match bun_sys::open(&ZBox::from_bytes(path), flags, 0o644) {
                Ok(file) => (native_descriptor(file), is_json),
                Err(_) => (native_descriptor(Fd::stderr()), is_json_format(format)),
            }
        }
    };
    Bun__AOT__setMismatchLog(descriptor, is_json);
}

fn identity_error_sentence(error: IdentityError) -> &'static str {
    match error {
        IdentityError::NoBuildId => "this executable has no build id",
        IdentityError::UnrecognizedExecutable => "unrecognized executable format",
        IdentityError::Malformed => "malformed executable headers",
    }
}

#[rustfmt::skip]
fn sentence_of(verdict: ImageVerdict) -> Option<&'static str> {
    Some(match verdict {
        ImageVerdict::Accepted => return None,
        ImageVerdict::Unsupported => "this build of Bun doesn't support ahead-of-time compiled code",
        ImageVerdict::CompiledCodeDisabled => "compiled code is disabled (BUN_JSC_useAOT=0)",
        ImageVerdict::NotAnImage => "the file is corrupt (bad header)",
        ImageVerdict::Truncated => "the file is truncated. Copy or download it again",
        ImageVerdict::Misaligned => "the code isn't page-aligned. Something modified the executable after it was built",
        ImageVerdict::AlreadyInUse => "this process has already loaded another compiled program",
        ImageVerdict::LowPagesAccessible => "it needs the lowest pages of the address space to be unmapped, and this system maps them",
        ImageVerdict::NoCode => "it contains no code",
        ImageVerdict::CannotMapCode => "its code could not be mapped as executable memory",
        ImageVerdict::NeedsCellCage => "it needs a reserved address range for the JavaScript heap, and this process doesn't have one. Rebuild with --aot-huge-heap to remove the heap limit",
        ImageVerdict::OptionsConflict => "it was built with different engine options than this process uses. Unset any BUN_JSC_* environment variables, or rebuild",
        ImageVerdict::MalformedTables => "the file is corrupt (bad tables)",
        ImageVerdict::StampMismatch => "the compiler that built it doesn't match the runtime in this executable. Rebuild it",
        ImageVerdict::IdentityMismatch => "it was built for a different build of Bun than the one in this executable. Rebuild it",
        ImageVerdict::CodeAtFixedAddress => "its code can't be placed at a random address here, and it doesn't run at a fixed one. The system refuses to map the file as executable memory and to move the loaded code with mremap (Linux 5.13 or later)",
    })
}

fn exit_with(sentence: &str) -> ! {
    bun_core::Output::err_generic("can't run this executable's compiled code: {}", (sentence,));
    bun_core::Output::flush();
    bun_core::Global::exit(1)
}
