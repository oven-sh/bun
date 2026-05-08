//! Process information and control APIs (`globalThis.process` / `node:process`)

use core::ffi::c_char;

use bun_jsc::{JSGlobalObject, JSValue, WebWorker};
use bun_jsc::zig_string::ZigString;
use bun_core::{self, Environment, Global};
use bun_core::env_var::feature_flag;

// TODO(port): move to <area>_sys — extern decls colocated for now
unsafe extern "C" {
    fn Bun__Process__getArgv(global: *const JSGlobalObject) -> JSValue;
    fn Bun__Process__getExecArgv(global: *const JSGlobalObject) -> JSValue;
}

// ───────────────────────────── argv0 / execPath ─────────────────────────────

#[unsafe(export_name = "Bun__Process__createArgv0")]
pub extern "C" fn create_argv0(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global = unsafe { &*global_object };
    let argv0 = bun_core::argv().get(0).map(|z| z.as_bytes()).unwrap_or(b"bun");
    ZigString::from_utf8(argv0).to_js(global)
}

#[unsafe(export_name = "Bun__Process__getExecPath")]
pub extern "C" fn get_exec_path(global_object: *const JSGlobalObject) -> JSValue {
    let Ok(out) = bun_core::self_exe_path() else {
        // if for any reason we are unable to get the executable path, we just return argv[0]
        return create_argv0(global_object);
    };
    // SAFETY: global_object is valid for the duration of this call
    let global = unsafe { &*global_object };
    ZigString::from_utf8(out.as_bytes()).to_js(global)
}

// ───────────────────────────── argv (C++ accessor wrappers) ─────────────────

pub extern "C" fn get_argv(global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into C++; global is valid
    unsafe { Bun__Process__getArgv(global) }
}

pub extern "C" fn get_exec_argv(global: &JSGlobalObject) -> JSValue {
    // SAFETY: FFI call into C++; global is valid
    unsafe { Bun__Process__getExecArgv(global) }
}

// ───────────────────────────── exit ─────────────────────────────

// TODO(@190n) this may need to be noreturn
#[unsafe(export_name = "Bun__Process__exit")]
pub extern "C" fn exit(global_object: *const JSGlobalObject, code: u8) {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    let vm = global_object.bun_vm().as_mut();
    // SAFETY: vm is the live per-thread VirtualMachine for this global.
    unsafe { (*vm).exit_handler.exit_code = code };
    // SAFETY: worker is either None or a valid `*const WebWorker` (BACKREF set
    // by `init_worker`).
    if let Some(worker) = unsafe { (*vm).worker } {
        // TODO(@190n) we may need to use requestTerminate or throwTerminationException
        // instead to terminate the worker sooner
        // SAFETY: worker pointer is valid for the lifetime of the VM.
        unsafe { (*worker.cast::<WebWorker>()).exit() };
    } else {
        // SAFETY: vm is the live per-thread VirtualMachine; on_exit/global_exit
        // are the canonical shutdown path.
        unsafe {
            (*vm).on_exit();
            (*vm).global_exit();
        }
    }
}

// ───────────────────────────── misc exports ─────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Bun__NODE_NO_WARNINGS() -> bool {
    feature_flag::NODE_NO_WARNINGS.get().unwrap_or(false)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__suppressCrashOnProcessKillSelfIfDesired() {
    if feature_flag::BUN_INTERNAL_SUPPRESS_CRASH_ON_PROCESS_KILL_SELF
        .get()
        .unwrap_or(false)
    {
        bun_crash_handler::suppress_reporting();
    }
}

// PORT NOTE: Zig `export const Foo: [*:0]const u8 = "..."` exports a static
// pointing at rodata. Rust raw-pointer statics are `!Sync`; wrap in a
// `#[repr(transparent)]` newtype so the C++ side still sees a single
// `const char*`-sized symbol.
#[repr(transparent)]
pub struct CStrPtr(*const c_char);
// SAFETY: the wrapped pointer always targets a `'static` NUL-terminated
// rodata literal produced by `concatcp!`; it is never written through.
unsafe impl Sync for CStrPtr {}

#[unsafe(no_mangle)]
pub static Bun__version: CStrPtr =
    CStrPtr(const_format::concatcp!("v", Global::package_json_version, "\0").as_ptr().cast::<c_char>());
#[unsafe(no_mangle)]
pub static Bun__version_with_sha: CStrPtr = CStrPtr(
    const_format::concatcp!("v", Global::package_json_version_with_sha, "\0").as_ptr().cast::<c_char>(),
);
// Version exports removed - now handled by build-generated header (bun_dependency_versions.h)
// The C++ code in BunProcess.cpp uses the generated header directly
#[unsafe(no_mangle)]
pub static Bun__versions_uws: CStrPtr =
    CStrPtr(const_format::concatcp!(Environment::GIT_SHA, "\0").as_ptr().cast::<c_char>());
#[unsafe(no_mangle)]
pub static Bun__versions_usockets: CStrPtr =
    CStrPtr(const_format::concatcp!(Environment::GIT_SHA, "\0").as_ptr().cast::<c_char>());
#[unsafe(no_mangle)]
pub static Bun__version_sha: CStrPtr =
    CStrPtr(const_format::concatcp!(Environment::GIT_SHA, "\0").as_ptr().cast::<c_char>());

mod _impl {
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc, SysErrorJsc, WebWorker};
use bun_jsc::bun_string_jsc;
use bun_jsc::zig_string::ZigString;
use bun_str::{String as BunString, strings};
use bun_sys as Syscall;
use bun_paths::{PathBuffer, SEP};
use bun_core::env_var;

#[cfg(windows)]
unsafe extern "C" {
    fn SetEnvironmentVariableW(name: *const u16, value: *const u16) -> i32;
}

// ───────────────────────────── title ─────────────────────────────

/// Guards reads/writes of `crate::cli::Bun__Node__ProcessTitle`. The static
/// itself owns the `Box<[u8]>`; this mutex only provides exclusion between
/// `get_title`/`set_title` (Zig: `var title_mutex = bun.Mutex{}`).
static TITLE_MUTEX: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

#[unsafe(export_name = "Bun__Process__getTitle")]
pub extern "C" fn get_title(_global: *const JSGlobalObject, title: *mut BunString) {
    let _guard = TITLE_MUTEX.lock();
    // SAFETY: TITLE_MUTEX held; the static is only mutated under this lock or
    // during single-threaded CLI startup, so a shared read is sound.
    let str_ = unsafe { (*crate::cli::Bun__Node__ProcessTitle.get()).as_deref() }
        .unwrap_or(b"bun");
    // SAFETY: title is a valid out-param provided by C++ caller
    unsafe {
        *title = BunString::clone_utf8(str_);
    }
}

// TODO: https://github.com/nodejs/node/blob/master/deps/uv/src/unix/darwin-proctitle.c
#[unsafe(export_name = "Bun__Process__setTitle")]
pub extern "C" fn set_title(_global_object: *const JSGlobalObject, newvalue: *mut BunString) {
    // SAFETY: newvalue is a valid pointer from C++; we consume one ref before
    // returning. `String` is `Copy`, so read it out by value and let
    // `OwnedString`'s Drop release the ref (Zig: `defer newvalue.deref()`).
    let newvalue = bun_str::OwnedString::new(unsafe { *newvalue });
    let _guard = TITLE_MUTEX.lock();

    // PORT NOTE: `to_owned_slice` is infallible (Vec<u8>) in the Rust port, so
    // the Zig OOM-throw path is unreachable here.
    let new_title: Box<[u8]> = newvalue.to_owned_slice().into_boxed_slice();

    // Zig: `if (old) |slice| allocator.free(slice); Bun__Node__ProcessTitle = new_title;`
    // — assigning into the `Option<Box<[u8]>>` static drops the previous box.
    // SAFETY: TITLE_MUTEX held; we are the exclusive writer.
    unsafe {
        *crate::cli::Bun__Node__ProcessTitle.get() = Some(new_title);
    }
}

// ───────────────────────────── execArgv ─────────────────────────────

// Zig: `@export(&host_fn.wrap1(createExecArgv), ...)` — the C++ caller
// (headers.h) declares `EncodedJSValue Bun__Process__createExecArgv(JSGlobalObject*)`,
// not a `JSHostFunctionType`. Hand-roll the wrap1 shim instead of `#[bun_jsc::host_fn]`.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Process__createExecArgv(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    bun_jsc::to_js_host_fn_result(global_object, create_exec_argv(global_object))
}

fn create_exec_argv(global_object: &JSGlobalObject) -> JsResult<JSValue> {
    // PERF(port): was stack-fallback alloc (4096 bytes) — profile in Phase B
    // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
    let vm = global_object.bun_vm();

    if let Some(worker) = vm.worker {
        // SAFETY: `vm.worker` is a BACKREF `*const c_void` set by `init_worker`
        // to the live `WebWorker` for this VM; valid while the VM is.
        let worker = unsafe { &*worker.cast::<WebWorker>() };
        // was explicitly overridden for the worker?
        if let Some(exec_argv) = worker.exec_argv() {
            let array = JSValue::create_empty_array(global_object, exec_argv.len())?;
            for (i, &wtf) in exec_argv.iter().enumerate() {
                array.put_index(
                    global_object,
                    u32::try_from(i).expect("int cast"),
                    BunString::init(wtf).to_js(global_object)?,
                )?;
            }
            return Ok(array);
        }
    }

    // For compiled/standalone executables, execArgv should contain compile_exec_argv and BUN_OPTIONS.
    // Use append_options_env for BUN_OPTIONS to correctly handle quoted values.
    if let Some(graph) = vm.standalone_module_graph {
        // `standalone_module_graph` is the lower-crate trait object
        // (`&'static dyn bun_resolver::StandaloneModuleGraph`); the field we
        // need is exposed via the trait so no downcast is required.
        let compile_exec_argv = graph.compile_exec_argv();
        let bun_options_argc = bun_core::bun_options_argc();
        if !compile_exec_argv.is_empty() || bun_options_argc > 0 {
            // `defer args.deinit()` + `defer for args |*a| a.deref()`
            let mut args = scopeguard::guard(Vec::<BunString>::new(), |v| {
                for a in &v {
                    a.deref();
                }
            });

            // Process BUN_OPTIONS first using append_options_env for proper quote handling.
            // append_options_env inserts starting at index 1, so we need a placeholder.
            if bun_options_argc > 0 {
                if let Some(opts) = env_var::BUN_OPTIONS.get() {
                    args.push(BunString::empty()); // placeholder for insert-at-1
                    bun_core::append_options_env::<BunString>(opts, &mut args);
                    let _ = args.remove(0); // remove placeholder
                }
            }

            if !compile_exec_argv.is_empty() {
                for token in compile_exec_argv
                    .split(|b| matches!(*b, b' ' | b'\t' | b'\n' | b'\r'))
                    .filter(|s: &&[u8]| !s.is_empty())
                {
                    args.push(BunString::clone_utf8(token));
                }
            }

            return bun_string_jsc::to_js_array(global_object, &args);
        }
        return JSValue::create_empty_array(global_object, 0);
    }

    let argv = bun_core::argv();
    // `defer args.deinit()` + `defer for args |*a| a.deref()`
    let mut args = scopeguard::guard(
        Vec::<BunString>::with_capacity(argv.len().saturating_sub(1)),
        |v| {
            for a in &v {
                a.deref();
            }
        },
    );

    let mut seen_run = false;
    let mut prev: Option<&[u8]> = None;

    // we re-parse the process argv to extract execArgv, since this is a very uncommon operation
    // it isn't worth doing this as a part of the CLI
    let mut iter = argv.iter();
    let _ = iter.next(); // skip argv[0]
    for arg in iter {
        // emulate `defer prev = arg` by setting at end of each iteration body
        let arg: &[u8] = arg;

        if arg.len() >= 1 && arg[0] == b'-' {
            args.push(BunString::clone_utf8(arg));
            prev = Some(arg);
            continue;
        }

        if !seen_run && arg == b"run" {
            seen_run = true;
            prev = Some(arg);
            continue;
        }

        // A set of execArgv args consume an extra argument, so we do not want to
        // confuse these with script names.
        // TODO(port): the Zig builds this set at comptime by iterating
        // `bun.cli.Arguments.auto_params` and emitting `--long` / `-s` for every
        // param with `takes_value != .none`. Rust cannot reflect over that list
        // at compile time, so build the set lazily at runtime from the same
        // `AUTO_PARAMS` table. Phase B may swap this for a phf::Set via
        // build.rs or a proc-macro.
        static MAP: std::sync::LazyLock<std::collections::HashSet<Vec<u8>>> =
            std::sync::LazyLock::new(|| {
                let mut set = std::collections::HashSet::new();
                for param in crate::cli::arguments::AUTO_PARAMS.iter() {
                    if param.takes_value != bun_clap::Values::None {
                        if let Some(name) = param.names.long {
                            let mut k = Vec::with_capacity(2 + name.len());
                            k.extend_from_slice(b"--");
                            k.extend_from_slice(name);
                            set.insert(k);
                        }
                        if let Some(name) = param.names.short {
                            set.insert(vec![b'-', name]);
                        }
                    }
                }
                set
            });

        if let Some(p) = prev {
            if MAP.contains(p) {
                args.push(BunString::clone_utf8(arg));
                prev = Some(arg);
                continue;
            }
        }

        // we hit the script name
        break;
    }

    bun_string_jsc::to_js_array(global_object, &args)
}

// ───────────────────────────── argv ─────────────────────────────

#[unsafe(export_name = "Bun__Process__createArgv")]
pub extern "C" fn create_argv(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
    let vm = global_object.bun_vm();

    // PERF(port): was stack-fallback alloc (32 * sizeof(ZigString) + MAX_PATH_BYTES + 1 + 32) — profile in Phase B

    // SAFETY: `vm.worker` is a BACKREF `*const c_void` set by `init_worker` to
    // the live `WebWorker` for this VM; valid while the VM is.
    let worker: Option<&WebWorker> = vm.worker.map(|w| unsafe { &*w.cast::<WebWorker>() });

    let args_count: usize = match worker {
        Some(w) => w.argv().len(),
        None => vm.argv.len(),
    };

    // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
    // argv also omits the script name
    let mut args_list: Vec<BunString> = Vec::with_capacity(args_count + 2);

    if vm.standalone_module_graph.is_some() {
        // Don't break user's code because they did process.argv.slice(2)
        // Even if they didn't type "bun", we still want to add it as argv[0]
        args_list.push(BunString::static_(b"bun"));
        // PERF(port): was assume_capacity
    } else {
        let exe_path = bun_core::self_exe_path().ok();
        args_list.push(match exe_path {
            Some(str_) => BunString::borrow_utf8(str_.as_bytes()),
            None => BunString::static_(b"bun"),
        });
        // PERF(port): was assume_capacity
    }

    // PORT NOTE: bun.pathLiteral inlined — bun_paths has no path_literal! macro yet.
    const EVAL_SUFFIX: &[u8] = if cfg!(windows) { b"\\[eval]" } else { b"/[eval]" };
    const STDIN_SUFFIX: &[u8] = if cfg!(windows) { b"\\[stdin]" } else { b"/[stdin]" };
    if !vm.main().is_empty()
        && !strings::ends_with(vm.main(), EVAL_SUFFIX)
        && !strings::ends_with(vm.main(), STDIN_SUFFIX)
    {
        if worker.is_some_and(|w| w.eval_mode()) {
            args_list.push(BunString::static_(b"[worker eval]"));
            // PERF(port): was assume_capacity
        } else {
            args_list.push(BunString::borrow_utf8(vm.main()));
            // PERF(port): was assume_capacity
        }
    }

    if let Some(worker) = worker {
        for &arg in worker.argv() {
            args_list.push(BunString::init(arg));
            // PERF(port): was assume_capacity
        }
    } else {
        for arg in &vm.argv {
            let str_ = BunString::borrow_utf8(arg);
            // https://github.com/yargs/yargs/blob/adb0d11e02c613af3d9427b3028cc192703a3869/lib/utils/process-argv.ts#L1
            args_list.push(str_);
            // PERF(port): was assume_capacity
        }
    }

    bun_string_jsc::to_js_array(global_object, &args_list).unwrap_or(JSValue::ZERO)
}

// ───────────────────────────── eval ─────────────────────────────

#[unsafe(export_name = "Bun__Process__getEval")]
pub extern "C" fn get_eval(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
    let vm = global_object.bun_vm();
    if let Some(source) = vm.module_loader.eval_source.as_deref() {
        return ZigString::init(source.contents()).to_js(global_object);
    }
    JSValue::UNDEFINED
}

// ───────────────────────────── cwd ─────────────────────────────

// Zig: `pub const getCwd = host_fn.wrap1(getCwd_)` — C++ (headers.h) declares
// `EncodedJSValue Bun__Process__getCwd(JSGlobalObject*)`. Hand-roll the wrap1
// shim instead of `#[bun_jsc::host_fn]` (caller is not a JSHostFunction).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Process__getCwd(global_object: *const JSGlobalObject) -> JSValue {
    // SAFETY: global_object is valid for the duration of this call
    let global_object = unsafe { &*global_object };
    bun_jsc::to_js_host_fn_result(global_object, get_cwd(global_object))
}

fn get_cwd(global_object: &JSGlobalObject) -> JsResult<JSValue> {
    let mut buf = PathBuffer::uninit();
    match crate::node::path::get_cwd(&mut buf) {
        bun_sys::Result::Ok(r) => Ok(ZigString::init(r).with_encoding().to_js(global_object)),
        bun_sys::Result::Err(e) => Err(global_object.throw_value(e.to_js(global_object))),
    }
}

// Zig: `pub const setCwd = host_fn.wrap2(setCwd_)` — C++ (headers.h) declares
// `EncodedJSValue Bun__Process__setCwd(JSGlobalObject*, ZigString*)`. Hand-roll
// the wrap2 shim; the second arg is the raw `*mut ZigString`, not a CallFrame.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Process__setCwd(
    global_object: *const JSGlobalObject,
    to: *mut ZigString,
) -> JSValue {
    // SAFETY: global_object/to are valid for the duration of this call (C++ caller contract)
    let global_object = unsafe { &*global_object };
    let to = unsafe { &*to };
    bun_jsc::to_js_host_fn_result(global_object, set_cwd(global_object, to))
}

fn set_cwd(global_object: &JSGlobalObject, to: &ZigString) -> JsResult<JSValue> {
    if to.length() == 0 {
        return Err(global_object
            .throw_invalid_arguments(format_args!("Expected path to be a non-empty string")));
    }
    // SAFETY: `bun_vm()` returns the live per-thread VM for this global.
    let vm = global_object.bun_vm();
    // SAFETY: `vm.transpiler.fs` is a live `*mut FileSystem` (process singleton).
    let fs = unsafe { &mut *vm.transpiler.fs };

    let mut buf = PathBuffer::uninit();
    let Ok(slice) = to.slice_z_buf(&mut buf) else {
        return Err(global_object.throw(format_args!("Invalid path")));
    };

    // Zig: `Syscall.chdir(fs.top_level_dir, slice)` — path=cwd, dest=target so the
    // resulting Node SystemError carries `path: cwd`, `dest: target` and the
    // `chdir '<cwd>' -> '<target>'` message format (test-process-chdir-errormessage).
    let top_level_dir: &[u8] = fs.top_level_dir;
    match Syscall::chdir(slice) {
        bun_sys::Result::Ok(()) => {
            // When we update the cwd from JS, we have to update the bundler's version as well
            // However, this might be called many times in a row, so we use a pre-allocated buffer
            // that way we don't have to worry about garbage collector
            let into_cwd_len = match Syscall::getcwd(&mut buf[..]) {
                bun_sys::Result::Ok(r) => r,
                bun_sys::Result::Err(err) => {
                    // roll back to the previous top_level_dir
                    let mut rollback = PathBuffer::uninit();
                    let _ = Syscall::chdir(bun_paths::resolve_path::z(fs.top_level_dir, &mut rollback));
                    return Err(global_object.throw_value(err.to_js(global_object)));
                }
            };
            fs.top_level_dir_buf[..into_cwd_len].copy_from_slice(&buf[..into_cwd_len]);
            fs.top_level_dir_buf[into_cwd_len] = 0;
            // SAFETY: `top_level_dir_buf` is a process-lifetime field of the
            // FileSystem singleton; transmuting the borrow to `'static` matches
            // the Zig semantics (`top_level_dir = top_level_dir_buf[0..len :0]`).
            fs.top_level_dir = unsafe {
                core::mem::transmute::<&[u8], &'static [u8]>(&fs.top_level_dir_buf[..into_cwd_len])
            };

            let len = fs.top_level_dir.len();
            // Ensure the path ends with a slash
            if fs.top_level_dir_buf[len - 1] != SEP {
                fs.top_level_dir_buf[len] = SEP;
                fs.top_level_dir_buf[len + 1] = 0;
                // SAFETY: see above.
                fs.top_level_dir = unsafe {
                    core::mem::transmute::<&[u8], &'static [u8]>(&fs.top_level_dir_buf[..len + 1])
                };
            }
            #[cfg(windows)]
            let without_trailing_slash = strings::without_trailing_slash_windows_path;
            #[cfg(not(windows))]
            let without_trailing_slash = strings::without_trailing_slash;
            let mut str_ = BunString::clone_utf8(without_trailing_slash(fs.top_level_dir));
            str_.transfer_to_js(global_object)
        }
        bun_sys::Result::Err(e) => {
            let e = e.with_path_dest(top_level_dir, slice.as_bytes());
            Err(global_object.throw_value(e.to_js(global_object)))
        }
    }
}

// ───────────────────────────── Windows env var ─────────────────────────────

// TODO: switch this to using *bun.wtf.String when it is added
#[cfg(windows)]
#[unsafe(export_name = "Bun__Process__editWindowsEnvVar")]
pub extern "C" fn bun_process_edit_windows_env_var(k: BunString, v: BunString) {
    const _: () = assert!(cfg!(windows));
    if k.tag() == bun_str::Tag::Empty {
        return;
    }
    let wtf1 = k.value().wtf_string_impl();
    // PERF(port): was stack-fallback alloc (1025 bytes) — profile in Phase B
    let mut buf1: Vec<u16> = vec![0u16; k.utf16_byte_length() + 1];
    let mut buf2: Vec<u16> = vec![0u16; v.utf16_byte_length() + 1];
    let len1: usize = if wtf1.is_8bit() {
        strings::copy_latin1_into_utf16(&mut buf1, wtf1.latin1_slice()).written
    } else {
        buf1[0..wtf1.length()].copy_from_slice(wtf1.utf16_slice());
        wtf1.length()
    };
    buf1[len1] = 0;

    static EMPTY_W: [u16; 1] = [0];
    let str2: Option<*const u16> = if v.tag() != bun_str::Tag::Dead {
        Some('str_: {
            if v.tag() == bun_str::Tag::Empty {
                break 'str_ EMPTY_W.as_ptr();
            }
            let wtf2 = v.value().wtf_string_impl();
            let len2: usize = if wtf2.is_8bit() {
                strings::copy_latin1_into_utf16(&mut buf2, wtf2.latin1_slice()).written
            } else {
                buf2[0..wtf2.length()].copy_from_slice(wtf2.utf16_slice());
                wtf2.length()
            };
            buf2[len2] = 0;
            buf2.as_ptr()
        })
    } else {
        None
    };
    // SAFETY: buf1[len1] == 0; str2 is either null or NUL-terminated
    unsafe {
        let _ = SetEnvironmentVariableW(
            buf1.as_ptr(),
            str2.unwrap_or(core::ptr::null()),
        );
    }
}
} // mod _impl

// ported from: src/runtime/node/node_process.zig
