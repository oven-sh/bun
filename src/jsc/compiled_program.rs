use core::sync::atomic::Ordering;
use std::collections::BTreeSet;

use bun_aot::ir::generated::{AdmittedCode, ImageVerdict};
#[cfg(bun_locked_environment)]
use bun_core::ZBox;
use bun_exe_format::identity::{HostDescription, IdentityError, find_process_identity};
use bun_options_types::standalone_path::is_bun_standalone_file_path;
use bun_resolver::StandaloneModuleGraph;
use bun_resolver::compiled_program::{CompiledEntryPoint, CompiledProgram};

use crate::virtual_machine::standalone_module_graph;
use crate::{JSGlobalObject, JSValue};

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
        all_images: Bytes,
        file_or_null: *const ImageFileArgument,
        identity: *const u8,
    ) -> u32;
    fn Bun__AOT__admittedCode(image: Bytes, admitted: *mut u32) -> bool;
    fn Bun__AOT__admitsUnknownJavaScript(image: Bytes) -> bool;
    fn Bun__AOT__loadsCodeOutsideImage(image: Bytes) -> bool;
    fn Bun__AOT__omitsFunctionSource(image: Bytes) -> bool;
    safe fn Bun__AOT__imageCode() -> Bytes;
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

#[cfg(bun_locked_environment)]
unsafe extern "C" {
    /// ZigGlobalObject.cpp
    fn Bun__isOptionThatCompiledCodeDoesNotTake(entry: *const core::ffi::c_char) -> bool;
    /// patches/mimalloc/environment-sets-sizes-and-pace-only.patch
    fn mi_is_read_from_environment(name_in_lower_case: *const core::ffi::c_char) -> bool;
}

pub fn compiled_program() -> Option<&'static CompiledProgram> {
    standalone_module_graph()?.compiled_program()
}

pub fn runs_in_place() -> bool {
    compiled_program().is_some_and(|program| program.preserves_source_paths)
}

/// BunCompiledModules.cpp
#[unsafe(no_mangle)]
pub extern "C" fn Bun__compiledProgramRunsInPlace() -> bool {
    runs_in_place()
}

fn bytes_of(image: &[u8]) -> Bytes {
    Bytes {
        ptr: image.as_ptr(),
        len: image.len(),
    }
}

/// What the options of the build say is the same in every image.
fn image_of(program: &CompiledProgram) -> Bytes {
    bytes_of(program.first_image())
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
    let admits = |image: &[u8]| unsafe { Bun__AOT__admitsUnknownJavaScript(bytes_of(image)) };
    program.images().any(admits)
}

/// Whether the program itself loads files with code that the build has not seen.
pub fn loads_code_outside_image(program: &CompiledProgram) -> bool {
    // SAFETY: the engine reads the image before it returns.
    unsafe { Bun__AOT__loadsCodeOutsideImage(image_of(program)) }
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
    // On Windows the path of a compiled module has backslashes, and the resolver joins the path of a file of the executable with forward slashes.
    let with_backslashes: Vec<u8>;
    let path = if cfg!(windows) && bun_core::strings::contains_char(path, b'/') {
        let to_backslash = |&byte: &u8| if byte == b'/' { b'\\' } else { byte };
        with_backslashes = path.iter().map(to_backslash).collect();
        &with_backslashes[..]
    } else {
        path
    };
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
    #[cfg(not(bun_hardened))]
    const PR_MDWE_NO_INHERIT: libc::c_ulong = 2;
    const UNUSED: libc::c_ulong = 0;

    static IS_FILTERED: core::sync::atomic::AtomicBool = core::sync::atomic::AtomicBool::new(false);

    #[cfg(bun_hardened)]
    pub(super) enum Failure {
        Failed {
            call: &'static str,
            errno: bun_errno::SystemErrno,
        },
        NotInForce {
            call: &'static str,
        },
    }

    /// What a check of the file can tell the two kinds of hardened build apart by.
    #[cfg(all(bun_hardened, not(bun_starts_without_mdwe)))]
    #[used]
    #[unsafe(no_mangle)]
    static Bun__startsOnlyWhereWriteExecuteMemoryIsDenied: [u8; 58] =
        *b"hardened start: the kernel must deny write-execute memory\0";
    #[cfg(all(bun_hardened, bun_starts_without_mdwe))]
    #[used]
    #[unsafe(no_mangle)]
    static Bun__startsWhereWriteExecuteMemoryCannotBeDenied: [u8; 58] =
        *b"hardened start: a kernel without PR_SET_MDWE is accepted \0";

    #[cfg(bun_locked_environment)]
    #[used]
    #[unsafe(no_mangle)]
    static Bun__readsFewEnvironmentVariables: [u8; 59] =
        *b"hardened environment: what only tests set is never read   \0";
    #[cfg(all(bun_hardened, not(bun_locked_environment)))]
    #[used]
    #[unsafe(no_mangle)]
    static Bun__readsEveryEnvironmentVariable: [u8; 59] =
        *b"hardened environment: every variable is read, as for tests\0";

    #[cfg(not(bun_refuses_execute_only_start))]
    #[used]
    #[unsafe(no_mangle)]
    pub(super) static Bun__startsWhereItsFileCannotBeRead: [u8; 76] =
        *b"execute-only start: where its file cannot be read, the loaded code is moved\0";
    #[cfg(bun_refuses_execute_only_start)]
    #[used]
    #[unsafe(no_mangle)]
    pub(super) static Bun__startsOnlyWhereItsFileCanBeRead: [u8; 76] =
        *b"execute-only start: where its file cannot be read, it does not start       \0";

    #[cfg(bun_hardened)]
    fn last_errno() -> bun_errno::SystemErrno {
        bun_errno::from_errno(bun_sys::last_errno())
    }

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
    fn gain_no_new_privileges() -> Result<(), Failure> {
        let call = "prctl(PR_SET_NO_NEW_PRIVS)";
        let yes: libc::c_ulong = 1;
        // SAFETY: the requests take and return integers only.
        let (set, in_force) = unsafe {
            let set = libc::prctl(libc::PR_SET_NO_NEW_PRIVS, yes, UNUSED, UNUSED, UNUSED);
            let errno = last_errno();
            let read = libc::prctl(libc::PR_GET_NO_NEW_PRIVS, UNUSED, UNUSED, UNUSED, UNUSED);
            ((set, errno), read == 1)
        };
        match (in_force, set) {
            (true, _) => Ok(()),
            (false, (0, _)) => Err(Failure::NotInForce { call }),
            (false, (_, errno)) => Err(Failure::Failed { call, errno }),
        }
    }

    #[cfg(bun_hardened)]
    fn install(
        program: &[bun_exe_format::executable_memory_filter::Instruction],
    ) -> Result<(), Failure> {
        const SET_MODE_FILTER: libc::c_ulong = 1;
        const ALL_THREADS: libc::c_ulong = 1;
        let filter = libc::sock_fprog {
            len: program.len() as libc::c_ushort,
            filter: program.as_ptr().cast_mut().cast(),
        };
        // SAFETY: the kernel copies the program, which has the layout of `sock_filter`, before the call returns.
        let answer = unsafe {
            libc::syscall(
                libc::SYS_seccomp,
                SET_MODE_FILTER,
                ALL_THREADS,
                &raw const filter,
            )
        };
        let errno = match answer {
            0 => return Ok(()),
            -1 => last_errno(),
            // The id of a thread that could not take the filter.
            _ => bun_errno::SystemErrno::ESRCH,
        };
        let call = "seccomp(SECCOMP_SET_MODE_FILTER)";
        Err(Failure::Failed { call, errno })
    }

    #[cfg(bun_hardened)]
    pub(super) fn refuse_new_executable_memory(
        image_code: core::ops::Range<u64>,
    ) -> Result<(), Failure> {
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
        install(&program)?;
        IS_FILTERED.store(true, core::sync::atomic::Ordering::Relaxed);
        Ok(())
    }

    /// Kernels before 6.7 reject `PR_MDWE_NO_INHERIT`, and child processes may need a JIT.
    #[cfg(not(bun_hardened))]
    pub(super) fn deny() {
        if is_denied_by_the_kernel() {
            return;
        }
        let bits = PR_MDWE_REFUSE_EXEC_GAIN | PR_MDWE_NO_INHERIT;
        // SAFETY: the request takes and returns integers only.
        unsafe { libc::prctl(PR_SET_MDWE, bits, UNUSED, UNUSED, UNUSED) };
    }

    /// Child processes inherit it. Whoever started this process may have set it already.
    #[cfg(bun_hardened)]
    pub(super) fn deny() -> Result<(), Failure> {
        #[cfg(not(bun_starts_without_mdwe))]
        core::hint::black_box(&raw const Bun__startsOnlyWhereWriteExecuteMemoryIsDenied);
        #[cfg(bun_starts_without_mdwe)]
        core::hint::black_box(&raw const Bun__startsWhereWriteExecuteMemoryCannotBeDenied);
        #[cfg(bun_locked_environment)]
        core::hint::black_box(&raw const Bun__readsFewEnvironmentVariables);
        #[cfg(not(bun_locked_environment))]
        core::hint::black_box(&raw const Bun__readsEveryEnvironmentVariable);
        gain_no_new_privileges()?;
        if is_denied_by_the_kernel() {
            return Ok(());
        }
        let call = "prctl(PR_SET_MDWE), which Linux has since 6.3,";
        let bits = PR_MDWE_REFUSE_EXEC_GAIN;
        // SAFETY: the request takes and returns integers only.
        let set = unsafe { libc::prctl(PR_SET_MDWE, bits, UNUSED, UNUSED, UNUSED) };
        let errno = last_errno();
        if is_denied_by_the_kernel() {
            return Ok(());
        }
        if set == 0 {
            return Err(Failure::NotInForce { call });
        }
        if cfg!(bun_starts_without_mdwe) && errno == bun_errno::SystemErrno::EINVAL {
            return Ok(());
        }
        Err(Failure::Failed { call, errno })
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

#[cfg(bun_hardened)]
pub fn deny_write_execute_memory() {
    if let Err(failure) = write_execute::deny() {
        exit_with(&sentence_of_failure(failure));
    }
}

/// Each of the three tables is the one that keeps the variable from being read.
#[cfg(bun_locked_environment)]
fn is_never_read(entry: &core::ffi::CStr, name: &[u8]) -> bool {
    // The allocator compares names without regard to case.
    if name
        .get(..9)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"mimalloc_"))
    {
        let name = ZBox::from_vec(name.to_ascii_lowercase());
        // SAFETY: `name` ends with a NUL and outlives the call.
        return !unsafe { mi_is_read_from_environment(name.as_ptr()) };
    }
    // SAFETY: `entry` ends with a NUL and outlives the call.
    bun_core::is_never_read(name)
        || unsafe { Bun__isOptionThatCompiledCodeDoesNotTake(entry.as_ptr()) }
}

#[cfg(bun_locked_environment)]
fn sentence_of_variables_never_read(names: &[&[u8]]) -> Option<String> {
    let (last, others) = names.split_last()?;
    let mut list = others.join(&b", "[..]);
    if !others.is_empty() {
        list.extend_from_slice(b" and ");
    }
    list.extend_from_slice(last);
    Some(format!(
        "the environment sets {}, which this build of Bun never reads",
        bstr::BStr::new(&list)
    ))
}

/// A setting that would be ignored is not lost without a word. By its name alone: so is one with an empty value.
#[cfg(bun_locked_environment)]
pub fn refuse_variables_that_are_never_read() {
    let names: Vec<&[u8]> = bun_sys::environ()
        .iter()
        .filter_map(|&entry| {
            // SAFETY: an entry of the environment ends with a NUL and lives as long as the process.
            let entry = unsafe { core::ffi::CStr::from_ptr(entry) };
            let bytes = entry.to_bytes();
            let end = bun_core::strings::index_of_char_usize(bytes, b'=').unwrap_or(bytes.len());
            let name = &bytes[..end];
            is_never_read(entry, name).then_some(name)
        })
        .collect();
    if let Some(sentence) = sentence_of_variables_never_read(&names) {
        exit_with(&sentence);
    }
}

static IDENTITY: std::sync::OnceLock<[u8; 16]> = std::sync::OnceLock::new();

/// A VM that this thread creates from here on runs the program of the image.
fn use_image_on_this_thread(program: &'static CompiledProgram, image: &'static [u8]) {
    let identity = IDENTITY.get().expect("the main thread has found it");
    let offset_in_images = image.as_ptr() as usize - program.image.as_ptr() as usize;
    let file = program.backing_file.as_ref().map(|file| ImageFileArgument {
        descriptor: file.descriptor,
        offset: file.offset + offset_in_images as i64,
    });
    // SAFETY: the images are part of the `'static` graph, which is never unmapped. `file` and
    // `identity` outlive the call.
    let raw_verdict = unsafe {
        Bun__AOT__useImage(
            bytes_of(image),
            bytes_of(program.image),
            file.as_ref().map_or(core::ptr::null(), core::ptr::from_ref),
            identity.as_ptr(),
        )
    };
    let verdict = ImageVerdict::from_wire(raw_verdict).unwrap_or(ImageVerdict::Unsupported);
    if let Some(sentence) = sentence_of(verdict) {
        exit_with(sentence);
    }
}

pub(crate) fn has_image_for_each_entry_point() -> bool {
    compiled_program().is_some_and(|program| program.images().nth(1).is_some())
}

/// The image of the program that a Worker runs whose entry point resolves to `path`.
pub(crate) fn image_of_worker(path: Option<&[u8]>) -> &'static [u8] {
    let graph = standalone_module_graph().expect("it has a compiled program");
    let program = graph.compiled_program().expect("it has several images");
    let key = path.map(|path| entry_module_key_in(graph, path));
    key.map_or_else(
        || program.first_image(),
        |key| program.image_beginning_at(key),
    )
}

/// On the thread of a Worker, before its VM is created.
pub(crate) fn use_image_of_worker(image: &'static [u8]) {
    if let Some(program) = compiled_program() {
        use_image_on_this_thread(program, image);
    }
}

pub(crate) fn use_image(graph: &'static dyn StandaloneModuleGraph) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    let Some(program) = graph.compiled_program() else {
        return;
    };
    ONCE.call_once(|| {
        // Keeps the linker from dropping it.
        core::hint::black_box(&raw const HOST_DESCRIPTION);
        #[cfg(all(target_os = "linux", not(bun_refuses_execute_only_start)))]
        core::hint::black_box(&raw const write_execute::Bun__startsWhereItsFileCannotBeRead);
        #[cfg(all(target_os = "linux", bun_refuses_execute_only_start))]
        core::hint::black_box(&raw const write_execute::Bun__startsOnlyWhereItsFileCanBeRead);
        #[cfg(bun_hardened)]
        if program.backing_file.is_some() {
            exit_with(
                "this build of Bun only runs compiled code that is part of the executable itself",
            );
        }
        #[cfg(bun_hardened)]
        deny_write_execute_memory();
        #[cfg(bun_locked_environment)]
        refuse_variables_that_are_never_read();
        bun_resolve_builtins::seal_internals();
        #[cfg(not(bun_locked_environment))]
        settings_for_debugging::set_mismatch_log();
        #[cfg(not(bun_locked_environment))]
        let is_verbose = settings_for_debugging::set_verbose();
        let identity = match find_process_identity() {
            Ok(identity) => identity,
            Err(error) => exit_with(identity_error_sentence(error)),
        };
        let _ = IDENTITY.set(identity);
        use_image_on_this_thread(program, program.first_image());
        #[cfg(not(bun_hardened))]
        write_execute::deny();
        #[cfg(bun_hardened)]
        {
            let code = Bun__AOT__imageCode();
            let code = code.ptr as u64..code.ptr as u64 + code.len as u64;
            if let Err(failure) = write_execute::refuse_new_executable_memory(code) {
                exit_with(&sentence_of_failure(failure));
            }
        }
        program.set_module_lookup(find_module_path);
        bun_crash_handler::report_aborts();
        #[cfg(not(bun_locked_environment))]
        if is_verbose {
            settings_for_debugging::print_image_summary(program.first_image().len());
        }
        bun_analytics::features::aot.fetch_add(1, Ordering::Relaxed);
    });
}

/// What the BUN_AOT_ variables ask for.
#[cfg(not(bun_locked_environment))]
mod settings_for_debugging {
    use bun_core::{Fd, ZBox};
    use bun_sys::O;

    use super::Bun__AOT__imageCode;

    const NO_LOG_DESCRIPTOR: isize = -1;

    unsafe extern "C" {
        safe fn Bun__AOT__setMismatchLog(descriptor: isize, is_json: bool);
        safe fn Bun__AOT__setMismatchLogFormat(is_json: bool);
        safe fn Bun__AOT__setVerbose(is_verbose: bool);
    }

    pub(super) fn image_summary(
        image_size: usize,
        code_size: usize,
        code_address: usize,
    ) -> String {
        format!("[aot] image: {image_size} bytes, {code_size} of code at {code_address:#x}")
    }

    pub(super) fn print_image_summary(image_size: usize) {
        let code = Bun__AOT__imageCode();
        bun_core::Output::print_errorln(image_summary(image_size, code.len, code.ptr as usize));
        bun_core::Output::flush();
    }

    #[derive(Debug, PartialEq, Eq)]
    pub(super) enum LogRequest<'a> {
        Off,
        FormatOnly { is_json: bool },
        StandardError { is_json: bool },
        File { path: &'a [u8], is_json: bool },
    }

    fn is_json_format(format: Option<&[u8]>) -> bool {
        matches!(format, Some(b"json"))
    }

    pub(super) fn mismatch_log_request<'a>(
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

    pub(super) fn set_verbose() -> bool {
        let is_verbose = bun_core::env_var::BUN_AOT_VERBOSE.get().unwrap_or(false);
        Bun__AOT__setVerbose(is_verbose);
        is_verbose
    }

    pub(super) fn set_mismatch_log() {
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
        #[cfg(not(bun_refuses_execute_only_start))]
        ImageVerdict::CodeAtFixedAddress => "its code can't be placed at a random address here, and it doesn't run at a fixed one. The system refuses to map the file as executable memory and to move the loaded code with mremap (Linux 5.13 or later)",
        #[cfg(bun_refuses_execute_only_start)]
        ImageVerdict::CodeAtFixedAddress => "its code can't be placed at a random address here, and it doesn't run at a fixed one. The system refuses to map the file as executable memory",
        ImageVerdict::OutsideItsSegments => "its header names code or data outside the segments the executable loads them in. Something modified the executable after it was built",
        ImageVerdict::CannotReadExecutable => "the executable's own file can't be opened for reading, and this build of Bun doesn't run without that",
    })
}

#[cfg(bun_hardened)]
fn sentence_of_failure(failure: write_execute::Failure) -> String {
    use write_execute::Failure::{Failed, NotInForce};
    let what_happened = match failure {
        Failed { call, errno } => format!("{call} failed with {errno}"),
        NotInForce { call } => format!("{call} succeeded and is not in force"),
    };
    format!("{what_happened}, and this build of Bun doesn't run without it")
}

fn exit_with(sentence: &str) -> ! {
    bun_core::Output::err_generic("can't run this executable's compiled code: {}", (sentence,));
    bun_core::Output::flush();
    bun_core::Global::exit(1)
}

#[cfg(test)]
mod tests {
    use super::settings_for_debugging::{
        LogRequest, image_summary, mismatch_log_request as request,
    };
    use super::*;

    const PATH: &[u8] = b"/tmp/mismatches.jsonl";

    fn stderr(is_json: bool) -> Option<LogRequest<'static>> {
        Some(LogRequest::StandardError { is_json })
    }

    fn file(is_json: bool) -> Option<LogRequest<'static>> {
        let path = PATH;
        Some(LogRequest::File { path, is_json })
    }

    const SOURCE_PATH: &[u8] = b"/project/app.ts";
    const GRAPH_NAME: &[u8] = if cfg!(windows) {
        b"B:/~BUN/root/app.js"
    } else {
        b"/$bunfs/root/app.js"
    };
    const MODULE_PATH: &[u8] = if cfg!(windows) {
        b"B:/~BUN/root/app.ts"
    } else {
        b"/$bunfs/root/app.ts"
    };
    const UNKNOWN_GRAPH_NAME: &[u8] = if cfg!(windows) {
        b"B:/~BUN/root/other.js"
    } else {
        b"/$bunfs/root/other.js"
    };

    struct FakeGraph {
        program: Option<CompiledProgram>,
    }

    impl StandaloneModuleGraph for FakeGraph {
        fn find_assume_standalone_path(&self, _name: &[u8]) -> Option<&'static [u8]> {
            None
        }
        fn base_public_path_with_default_suffix(&self) -> &'static [u8] {
            b""
        }
        fn compile_exec_argv(&self) -> &[u8] {
            b""
        }
        fn compiled_program(&self) -> Option<&CompiledProgram> {
            self.program.as_ref()
        }
        fn compiled_entry_point(&self, name: &[u8]) -> Option<&CompiledEntryPoint> {
            let program = self.program.as_ref()?;
            (name == GRAPH_NAME || name == MODULE_PATH).then(|| &program.entry_points[0])
        }
    }

    fn graph_of(program: Option<CompiledProgram>) -> &'static dyn StandaloneModuleGraph {
        Box::leak(Box::new(FakeGraph { program }))
    }

    fn graph_with_entry_point(preserves_source_paths: bool) -> &'static dyn StandaloneModuleGraph {
        let entry_point = CompiledEntryPoint {
            file_index: 0,
            module_id: 7,
            source_path: SOURCE_PATH,
            module_path: MODULE_PATH,
        };
        graph_of(Some(CompiledProgram::new(
            b"image",
            None,
            Box::new([entry_point]),
            Box::new([0]),
            preserves_source_paths,
        )))
    }

    #[test]
    fn module_key_is_module_path() {
        let graph = graph_with_entry_point(false);
        assert_eq!(entry_module_key_in(graph, GRAPH_NAME), MODULE_PATH);
        assert_eq!(entry_module_key_in(graph, MODULE_PATH), MODULE_PATH);
        assert_eq!(entry_module_key_in(graph, SOURCE_PATH), MODULE_PATH);
    }

    #[test]
    fn module_key_in_place_is_source_path() {
        let graph = graph_with_entry_point(true);
        assert_eq!(entry_module_key_in(graph, GRAPH_NAME), SOURCE_PATH);
        assert_eq!(entry_module_key_in(graph, SOURCE_PATH), SOURCE_PATH);
    }

    #[test]
    fn unknown_path_is_unchanged() {
        for graph in [graph_with_entry_point(false), graph_with_entry_point(true)] {
            assert_eq!(
                entry_module_key_in(graph, UNKNOWN_GRAPH_NAME),
                UNKNOWN_GRAPH_NAME
            );
            assert_eq!(
                entry_module_key_in(graph, b"/project/other.ts"),
                b"/project/other.ts"
            );
        }
    }

    #[test]
    fn graph_without_compiled_program_changes_nothing() {
        let graph = graph_of(None);
        assert_eq!(entry_module_key_in(graph, GRAPH_NAME), GRAPH_NAME);
        assert_eq!(entry_module_key_in(graph, SOURCE_PATH), SOURCE_PATH);
    }

    #[test]
    fn unset_variables_request_nothing() {
        assert_eq!(request(None, None), None);
    }

    #[test]
    fn off_ignores_format() {
        assert_eq!(request(Some(b"off"), None), Some(LogRequest::Off));
        assert_eq!(request(Some(b"off"), Some(b"json")), Some(LogRequest::Off));
    }

    #[test]
    fn standard_error_defaults_to_text() {
        assert_eq!(request(Some(b"stderr"), None), stderr(false));
        assert_eq!(request(Some(b"stderr"), Some(b"text")), stderr(false));
        assert_eq!(request(Some(b"stderr"), Some(b"json")), stderr(true));
    }

    #[test]
    fn format_alone_names_no_destination() {
        let format_only = |is_json| Some(LogRequest::FormatOnly { is_json });
        assert_eq!(request(None, Some(b"text")), format_only(false));
        assert_eq!(request(None, Some(b"json")), format_only(true));
    }

    #[test]
    fn file_defaults_to_json() {
        assert_eq!(request(Some(PATH), None), file(true));
        assert_eq!(request(Some(PATH), Some(b"json")), file(true));
        assert_eq!(request(Some(PATH), Some(b"text")), file(false));
    }

    #[test]
    fn format_is_case_sensitive() {
        assert_eq!(request(Some(PATH), Some(b"JSON")), file(false));
        assert_eq!(request(Some(b"stderr"), Some(b"JSON")), stderr(false));
    }

    #[test]
    fn image_summary_has_sizes_and_code_address() {
        assert_eq!(
            image_summary(81920, 16384, 0x1234_c000),
            "[aot] image: 81920 bytes, 16384 of code at 0x1234c000"
        );
    }

    #[test]
    fn rejection_sentences_are_distinct() {
        let mut sentences = Vec::new();
        for raw in 0..ImageVerdict::COUNT as u32 {
            let verdict = ImageVerdict::from_wire(raw).unwrap();
            let sentence = sentence_of(verdict);
            assert_eq!(sentence.is_none(), verdict == ImageVerdict::Accepted);
            sentences.extend(sentence);
        }
        assert_eq!(sentences.len(), ImageVerdict::COUNT - 1);
        sentences.sort_unstable();
        sentences.dedup();
        assert_eq!(sentences.len(), ImageVerdict::COUNT - 1);
    }
}
